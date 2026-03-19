import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { format } from "date-fns";

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
  });

  if (!activity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Day-based: find planned workout on the same date
  const localDate = format(new Date(activity.startDateLocal), "yyyy-MM-dd");
  const dayStart = new Date(localDate + "T00:00:00.000Z");
  const dayEnd = new Date(localDate + "T23:59:59.999Z");

  const plannedWorkout = await prisma.plannedWorkout.findFirst({
    where: {
      plan: { userId: session.userId, status: "active" },
      date: { gte: dayStart, lte: dayEnd },
      workoutType: { not: "rest" },
    },
    select: {
      id: true,
      title: true,
      workoutType: true,
      targetDistanceKm: true,
      targetPace: true,
      targetDurationMin: true,
      description: true,
    },
  });

  const matchedWorkout = plannedWorkout
    ? {
        id: plannedWorkout.id,
        title: plannedWorkout.title,
        workoutType: plannedWorkout.workoutType,
        targetDistanceKm: plannedWorkout.targetDistanceKm
          ? Number(plannedWorkout.targetDistanceKm)
          : null,
        targetPace: plannedWorkout.targetPace,
        targetDurationMin: plannedWorkout.targetDurationMin,
        description: plannedWorkout.description,
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
