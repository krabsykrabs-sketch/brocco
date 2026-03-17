import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// GET /api/plan — Get active plan for current user
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const plan = await prisma.plan.findFirst({
    where: { userId: session.userId, status: "active" },
    include: {
      phases: {
        orderBy: { orderIndex: "asc" },
      },
      weeklyTasks: {
        orderBy: [{ weekNumber: "asc" }, { category: "asc" }],
      },
      workouts: {
        orderBy: { date: "asc" },
        select: {
          id: true,
          phaseId: true,
          weekNumber: true,
          date: true,
          title: true,
          workoutType: true,
          activityType: true,
          targetDistanceKm: true,
          targetPace: true,
          targetDurationMin: true,
          description: true,
          status: true,
          matchedActivityId: true,
          matchedActivity: {
            select: {
              id: true,
              name: true,
              distanceKm: true,
              durationMin: true,
              avgPacePerKm: true,
              avgHeartRate: true,
            },
          },
        },
      },
    },
  });

  if (!plan) {
    return NextResponse.json({ plan: null });
  }

  return NextResponse.json({
    plan: {
      id: plan.id,
      name: plan.name,
      goal: plan.goal,
      raceDate: plan.raceDate,
      startDate: plan.startDate,
      endDate: plan.endDate,
      status: plan.status,
      phases: plan.phases.map((p) => ({
        id: p.id,
        name: p.name,
        orderIndex: p.orderIndex,
        description: p.description,
        startWeek: p.startWeek,
        endWeek: p.endWeek,
      })),
      weeklyTasks: plan.weeklyTasks.map((t) => ({
        id: t.id,
        weekNumber: t.weekNumber,
        description: t.description,
        category: t.category,
        status: t.status,
      })),
      workouts: plan.workouts.map((w) => ({
        id: w.id,
        phaseId: w.phaseId,
        weekNumber: w.weekNumber,
        date: w.date,
        title: w.title,
        workoutType: w.workoutType,
        activityType: w.activityType,
        targetDistanceKm: w.targetDistanceKm ? Number(w.targetDistanceKm) : null,
        targetPace: w.targetPace,
        targetDurationMin: w.targetDurationMin,
        description: w.description,
        status: w.status,
        matchedActivity: w.matchedActivity
          ? {
              id: w.matchedActivity.id,
              name: w.matchedActivity.name,
              distanceKm: w.matchedActivity.distanceKm ? Number(w.matchedActivity.distanceKm) : null,
              durationMin: Number(w.matchedActivity.durationMin),
              avgPacePerKm: w.matchedActivity.avgPacePerKm,
              avgHeartRate: w.matchedActivity.avgHeartRate,
            }
          : null,
      })),
    },
  });
}
