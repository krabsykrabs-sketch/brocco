import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseWall, wallDateString } from "@/lib/schedule";
import { activityDayKey } from "@/lib/plan-progress";
import { isCompatibleType } from "@/lib/activity-types";

/**
 * Everything the calendar's day view needs about one planned session that the
 * range endpoints deliberately leave out: the prescription (description,
 * structured steps), why it looks the way it does (the coach's last
 * adjustment), and the last comparable session to measure it against.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// How far back a "last similar session" may come from. Older than this and the
// comparison stops being useful — fitness has moved on.
const LOOKBACK_DAYS = 180;

interface DetailStep {
  kind: string;
  label: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  pace: string | null;
  times: number | null;
  steps: DetailStep[] | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Steps are stored exactly as the coach wrote them, and the tool schema spells
 * the fields snake_case while the watch-sync types use camelCase. Accept both
 * rather than silently rendering a step with no numbers on it.
 */
function normalizeSteps(raw: unknown, depth = 0): DetailStep[] {
  if (!Array.isArray(raw)) return [];
  const out: DetailStep[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const kind = str(o.kind) || "steady";
    out.push({
      kind,
      label: str(o.label),
      distanceKm: num(o.distanceKm) ?? num(o.distance_km),
      durationMin: num(o.durationMin) ?? num(o.duration_min),
      pace: str(o.pace),
      times: num(o.times),
      // One nesting level only — repeats hold plain steps, never more repeats.
      steps: kind === "repeat" && depth === 0 ? normalizeSteps(o.steps, 1) : null,
    });
  }
  return out;
}

/** GET /api/workouts/[id]/detail */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Scoped through the plan — an id from the client proves nothing.
  const workout = await prisma.plannedWorkout.findFirst({
    where: { id, plan: { userId: session.userId } },
  });
  if (!workout) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const workoutDate = wallDateString(workout.date);
  const dayStart = parseWall(workoutDate);
  const lookbackStart = new Date(dayStart.getTime() - LOOKBACK_DAYS * 86400000);

  const [adjustment, priorSameType, rawActivities] = await Promise.all([
    // The reason behind the numbers above: what the coach changed and why.
    // Undone adjustments are excluded — they no longer explain anything.
    prisma.planAdjustmentLog.findFirst({
      where: { workoutId: workout.id, userId: session.userId, undone: false },
      orderBy: { createdAt: "desc" },
      select: { reason: true, summary: true, action: true, createdAt: true },
    }),
    // Dates of earlier sessions of the same kind, across every plan the user
    // has had — they turn "last run" into "last long run".
    prisma.plannedWorkout.findMany({
      where: {
        plan: { userId: session.userId },
        workoutType: workout.workoutType,
        date: { gte: lookbackStart, lt: dayStart },
      },
      orderBy: { date: "desc" },
      take: 40,
      select: { date: true },
    }),
    prisma.activity.findMany({
      where: {
        userId: session.userId,
        startDateLocal: { gte: lookbackStart, lt: dayStart },
      },
      orderBy: { startDateLocal: "desc" },
      take: 80,
      select: {
        id: true,
        name: true,
        activityType: true,
        distanceKm: true,
        durationMin: true,
        avgPacePerKm: true,
        avgHeartRate: true,
        startDateLocal: true,
      },
    }),
  ]);

  const sameTypeDays = new Set(priorSameType.map((p) => wallDateString(p.date)));
  const compatible = rawActivities.filter((a) => isCompatibleType(workout.activityType, a.activityType));
  // Prefer a genuine like-for-like — an activity done on a day this same kind
  // of session was planned — and fall back to the last compatible one.
  const sameKind = compatible.find((a) => sameTypeDays.has(activityDayKey(a.startDateLocal)));
  const match = sameKind || compatible[0] || null;

  return NextResponse.json({
    workout: {
      id: workout.id,
      date: workoutDate,
      title: workout.title,
      workoutType: workout.workoutType,
      activityType: workout.activityType,
      targetDistanceKm: workout.targetDistanceKm ? Number(workout.targetDistanceKm) : null,
      targetPace: workout.targetPace,
      targetDurationMin: workout.targetDurationMin,
      description: workout.description,
      steps: normalizeSteps(workout.steps),
      status: workout.status,
    },
    adjustment: adjustment
      ? {
          reason: adjustment.reason,
          summary: adjustment.summary,
          action: adjustment.action,
          // A real instant, not a wall date — the client formats it in the
          // reader's own timezone.
          createdAt: adjustment.createdAt.toISOString(),
        }
      : null,
    comparable: match
      ? {
          activityId: match.id,
          date: activityDayKey(match.startDateLocal),
          name: match.name,
          activityType: match.activityType,
          distanceKm: match.distanceKm ? Number(match.distanceKm) : null,
          durationMin: match.durationMin ? Number(match.durationMin) : null,
          avgPacePerKm: match.avgPacePerKm,
          avgHeartRate: match.avgHeartRate,
          sameSessionType: !!sameKind,
        }
      : null,
  });
}
