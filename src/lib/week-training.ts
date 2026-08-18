import { prisma } from "@/lib/db";
import { parseWall, wallDateString, addDaysWall } from "@/lib/schedule";

/**
 * This week's training figures, computed once and correctly.
 *
 * The opener and the briefing each derived their own weekly running total, and
 * the opener's was wrong: it widened the activity query by a day either side to
 * absorb timezone offsets — which is right — and then never trimmed the pad
 * back off before summing. Last Sunday's run therefore landed in this week's
 * total, so the coach announced "5km into an 18km week" on a week with no
 * running in it at all.
 *
 * The pad is necessary and the trim is not optional. Keeping both in one place
 * is the only way they stay together.
 */

const RUN_TYPES = ["Run", "TrailRun", "VirtualRun", "Treadmill"];

export interface WeekActivity {
  id: string;
  name: string;
  activityType: string;
  distanceKm: number | null;
  durationMin: number | null;
  avgPacePerKm: string | null;
  avgHeartRate: number | null;
  startDateLocal: Date;
  source: string;
}

export interface WeekPlanned {
  title: string;
  workoutType: string;
  activityType: string;
  status: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  targetDurationMin: number | null;
  date: Date;
}

export interface WeekFigures {
  weekStartWall: Date;
  weekEndWall: Date;
  /** Activities inside the wall week — the pad has already been trimmed off. */
  activities: WeekActivity[];
  planned: WeekPlanned[];
  /** Running kilometres only. Bike and other sports are deliberately excluded. */
  runKm: number;
  /** Sum of planned session distances, excluding rest days. */
  plannedKm: number;
}

/** Monday of the week containing `todayStr` (yyyy-MM-dd), as a wall date. */
export function weekStartWallFor(todayStr: string): Date {
  const todayWall = parseWall(todayStr);
  const dow = todayWall.getUTCDay() === 0 ? 7 : todayWall.getUTCDay();
  return addDaysWall(todayWall, -(dow - 1));
}

/**
 * Trims a padded activity list back to the wall week. Exported so the boundary
 * rule can be tested directly rather than only through a route.
 */
export function trimToWallWeek<T extends { startDateLocal: Date }>(
  activities: T[],
  weekStartWall: Date
): T[] {
  const startKey = wallDateString(weekStartWall);
  const endKey = wallDateString(addDaysWall(weekStartWall, 6));
  return activities.filter((a) => {
    const key = wallDateString(a.startDateLocal);
    return key >= startKey && key <= endKey;
  });
}

export async function weekTrainingFigures(userId: string, todayStr: string): Promise<WeekFigures> {
  const weekStartWall = weekStartWallFor(todayStr);
  const weekEndWall = addDaysWall(weekStartWall, 6);

  // Widened by a day either side so an activity stored just outside the wall
  // boundary by a timezone offset is still fetched; trimmed by day key below.
  const [rawActivities, planned] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: {
          gte: new Date(weekStartWall.getTime() - 86400000),
          lte: new Date(weekEndWall.getTime() + 2 * 86400000),
        },
      },
      orderBy: { startDateLocal: "desc" },
      select: {
        id: true, name: true, activityType: true, distanceKm: true, durationMin: true,
        avgPacePerKm: true, avgHeartRate: true, startDateLocal: true, source: true,
      },
    }),
    prisma.plannedWorkout.findMany({
      where: { plan: { userId, status: "active" }, date: { gte: weekStartWall, lte: weekEndWall } },
      orderBy: { date: "asc" },
      select: {
        title: true, workoutType: true, activityType: true, status: true,
        targetDistanceKm: true, targetPace: true, targetDurationMin: true, date: true,
      },
    }),
  ]);

  const activities = trimToWallWeek(
    rawActivities.map((a) => ({ ...a, distanceKm: a.distanceKm ? Number(a.distanceKm) : null, durationMin: a.durationMin ? Number(a.durationMin) : null })),
    weekStartWall
  );

  const runKm = activities
    .filter((a) => RUN_TYPES.includes(a.activityType))
    .reduce((sum, a) => sum + (a.distanceKm ?? 0), 0);

  const plannedKm = planned
    .filter((w) => w.workoutType !== "rest")
    .reduce((sum, w) => sum + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

  return { weekStartWall, weekEndWall, activities, planned: planned as WeekPlanned[], runKm, plannedKm };
}
