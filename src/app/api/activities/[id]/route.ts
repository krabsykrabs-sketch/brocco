import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const activity = await prisma.activity.findFirst({
    where: { id, userId: session.userId },
    include: {
      plannedWorkouts: {
        select: {
          id: true,
          title: true,
          workoutType: true,
          targetDistanceKm: true,
          targetPace: true,
          targetDurationMin: true,
          description: true,
        },
      },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const matchedWorkout = activity.plannedWorkouts.length > 0
    ? {
        id: activity.plannedWorkouts[0].id,
        title: activity.plannedWorkouts[0].title,
        workoutType: activity.plannedWorkouts[0].workoutType,
        targetDistanceKm: activity.plannedWorkouts[0].targetDistanceKm
          ? Number(activity.plannedWorkouts[0].targetDistanceKm)
          : null,
        targetPace: activity.plannedWorkouts[0].targetPace,
        targetDurationMin: activity.plannedWorkouts[0].targetDurationMin,
        description: activity.plannedWorkouts[0].description,
      }
    : null;

  return NextResponse.json({
    activity: {
      id: activity.id,
      source: activity.source,
      stravaId: activity.stravaId,
      name: activity.name,
      activityType: activity.activityType,
      distanceKm: activity.distanceKm ? Number(activity.distanceKm) : null,
      durationMin: Number(activity.durationMin),
      movingTimeMin: activity.movingTimeMin ? Number(activity.movingTimeMin) : null,
      avgPacePerKm: activity.avgPacePerKm,
      paceSecondsPerKm: activity.paceSecondsPerKm,
      avgHeartRate: activity.avgHeartRate,
      maxHeartRate: activity.maxHeartRate,
      elevationGainM: activity.elevationGainM ? Number(activity.elevationGainM) : null,
      avgCadence: activity.avgCadence,
      calories: activity.calories,
      perceivedEffort: activity.perceivedEffort,
      startDate: activity.startDate,
      startDateLocal: activity.startDateLocal,
      splits: activity.splits,
      matchedWorkout,
    },
  });
}
