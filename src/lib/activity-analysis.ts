import { prisma } from "@/lib/db";
import type { Activity } from "@prisma/client";
import { getValidToken, fetchActivityStreams, fetchActivityLaps } from "@/lib/strava";
import { analyzeStreams, type StreamPoint, type ActivityAnalysis } from "@/lib/heart-rate-analysis";
import { RUN_TYPES } from "@/lib/activity-types";

const MIN_DURATION_SEC_FOR_ANALYSIS = 10 * 60; // 10 minutes — skip trivial jogs/warmups posted standalone

/**
 * Whether a stored activity is worth spending streams + laps API calls on.
 * Deliberately includes ordinary "easy" runs, not just quality sessions —
 * catching an easy run that was secretly run too hard is one of the main
 * points of this feature. HR is NOT required anymore: pace-based metrics
 * (best efforts, effort segments, pace fade) and laps work without a strap;
 * HR-dependent metrics (zones, decoupling) are simply omitted.
 */
export function isEligibleForAnalysis(
  activity: Pick<Activity, "activityType" | "avgHeartRate" | "durationMin">
): boolean {
  if (!RUN_TYPES.includes(activity.activityType)) return false;
  return Number(activity.durationMin) * 60 >= MIN_DURATION_SEC_FOR_ANALYSIS;
}

/** Explicit setting, else the highest max HR ever observed for this user. No wild guessing beyond that. */
async function resolveMaxHr(userId: string): Promise<number | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { hrMaxBpm: true },
  });
  if (profile?.hrMaxBpm) return profile.hrMaxBpm;

  const highest = await prisma.activity.aggregate({
    where: { userId, maxHeartRate: { not: null } },
    _max: { maxHeartRate: true },
  });
  return highest._max.maxHeartRate ?? null;
}

function normalizeStreams(raw: Record<string, { data: unknown[] }>): StreamPoint[] {
  const time = raw.time.data as number[];
  const distance = raw.distance.data as number[];
  const heartrate = (raw.heartrate?.data as number[] | undefined) ?? [];
  const velocity = raw.velocity_smooth.data as number[];
  const moving = (raw.moving?.data as boolean[] | undefined) ?? time.map(() => true);

  const points: StreamPoint[] = [];
  for (let i = 0; i < time.length; i++) {
    points.push({
      t: time[i],
      distanceM: distance[i] ?? 0,
      velocityMps: velocity[i] ?? 0,
      hr: heartrate[i] ?? null,
      moving: moving[i] ?? true,
    });
  }
  return points;
}

/**
 * Fetch streams, run the analysis engine, and store the result on the
 * activity. Safe to call repeatedly (e.g. re-analyze after the user changes
 * their max HR setting). Returns null — and stores nothing — if there's no
 * HR stream to analyze or no max HR reference point to compute zones
 * against; callers should treat null as "nothing to show", not an error.
 */
export async function analyzeActivity(userId: string, activityId: string): Promise<ActivityAnalysis | null> {
  const activity = await prisma.activity.findFirst({ where: { id: activityId, userId } });
  if (!activity || !activity.stravaId) return null;

  const token = await getValidToken(userId);

  // Laps: ground truth for interval execution, worth storing even when the
  // streams call fails. Only when there's real structure — a single
  // whole-run lap says nothing.
  const laps = await fetchActivityLaps(token, activity.stravaId);
  if (laps && laps.length >= 2) {
    await prisma.activity.update({
      where: { id: activity.id },
      data: { laps: laps as unknown as object },
    });
  }

  const maxHr = await resolveMaxHr(userId);

  const raw = await fetchActivityStreams(token, activity.stravaId);
  if (!raw) return null;

  const points = normalizeStreams(raw);

  // Match against the plan for the effort-vs-planned check (day-based, same
  // convention as the rest of the app — see activity-types.ts).
  const localDate = activity.startDateLocal.toISOString().slice(0, 10);
  const plannedWorkout = await prisma.plannedWorkout.findFirst({
    where: {
      plan: { userId, status: "active" },
      date: { gte: new Date(`${localDate}T00:00:00.000Z`), lte: new Date(`${localDate}T23:59:59.999Z`) },
      workoutType: { not: "rest" },
    },
    select: { workoutType: true },
  });

  const analysis = analyzeStreams(points, maxHr ?? null, plannedWorkout?.workoutType ?? null);

  await prisma.activity.update({
    where: { id: activity.id },
    data: { activityAnalysis: analysis as unknown as object },
  });

  return analysis;
}

/**
 * Analyze a batch of newly-synced activities (auto-sync / webhook path),
 * skipping ineligible ones and tolerating individual failures so one bad
 * activity doesn't block the rest.
 */
export async function analyzeEligibleActivities(userId: string, activities: Activity[]): Promise<void> {
  for (const activity of activities) {
    if (!isEligibleForAnalysis(activity)) continue;
    try {
      await analyzeActivity(userId, activity.id);
    } catch (err) {
      console.error(`Failed to analyze activity ${activity.id}:`, err);
    }
  }
}
