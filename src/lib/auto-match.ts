import { prisma } from "@/lib/db";
import { format } from "date-fns";

/**
 * Auto-match an activity to a planned workout on the same local date
 * with a compatible activity type.
 */
export async function autoMatchActivity(activityId: string, userId: string): Promise<string | null> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { startDateLocal: true, activityType: true, distanceKm: true },
  });

  if (!activity) return null;

  const localDate = format(new Date(activity.startDateLocal), "yyyy-MM-dd");
  // Use a date range to avoid timezone edge cases:
  // planned_workouts.date is a Postgres `date` column (no time component)
  const dayStart = new Date(localDate + "T00:00:00.000Z");
  const dayEnd = new Date(localDate + "T23:59:59.999Z");

  // Find planned workouts on the same date that are still 'planned' or 'modified'
  const candidates = await prisma.plannedWorkout.findMany({
    where: {
      plan: { userId, status: "active" },
      date: { gte: dayStart, lte: dayEnd },
      status: { in: ["planned", "modified"] },
      matchedActivityId: null,
    },
    select: {
      id: true,
      activityType: true,
      targetDistanceKm: true,
      workoutType: true,
    },
  });

  if (candidates.length === 0) return null;

  // Map Strava activity types to our activity kinds
  const typeMap: Record<string, string[]> = {
    run: ["Run", "TrailRun", "VirtualRun", "Treadmill"],
    cycle: ["Ride", "VirtualRide", "EBikeRide", "MountainBikeRide"],
    swim: ["Swim"],
    hike: ["Hike", "Walk"],
    strength: ["WeightTraining", "Workout"],
    other: [],
  };

  // Find compatible candidates
  const compatible = candidates.filter((c) => {
    const validTypes = typeMap[c.activityType] || [];
    return validTypes.includes(activity.activityType) || c.activityType === "other";
  });

  let match = compatible[0];

  // If multiple matches, pick the one closest in distance
  if (compatible.length > 1 && activity.distanceKm) {
    const actDist = Number(activity.distanceKm);
    match = compatible.reduce((best, c) => {
      const bestDist = best.targetDistanceKm ? Math.abs(Number(best.targetDistanceKm) - actDist) : Infinity;
      const cDist = c.targetDistanceKm ? Math.abs(Number(c.targetDistanceKm) - actDist) : Infinity;
      return cDist < bestDist ? c : best;
    });
  }

  // If no type-compatible match but only one candidate, still match (rest days excluded)
  if (!match && candidates.length === 1 && candidates[0].workoutType !== "rest") {
    match = candidates[0];
  }

  if (!match) return null;

  // Link activity to workout and mark completed
  await prisma.plannedWorkout.update({
    where: { id: match.id },
    data: {
      matchedActivityId: activityId,
      status: "completed",
    },
  });

  return match.id;
}
