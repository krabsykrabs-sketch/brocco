import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * POST /api/guided-workouts/sessions — record a played session.
 * Completed sessions also log a manual strength Activity (so they count
 * toward plan matching and weekly goals) and bump the saved workout's
 * counters. Bailed sessions record history only — no activity.
 * Returns ids so the client's undo toast can remove everything again.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "Workout").slice(0, 80);
  const durationMin = Math.min(Math.max(Number(body.durationMin) || 1, 1), 300);
  const completed = body.completed !== false;
  const bailedAtExercise =
    !completed && Number.isFinite(Number(body.bailedAtExercise))
      ? Math.max(0, Math.round(Number(body.bailedAtExercise)))
      : null;
  const startedAtMs = Number(body.startedAtMs);
  const startedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs) : new Date();

  // Only link a workout the user actually owns
  let workoutId: string | null = null;
  if (typeof body.workoutId === "string" && body.workoutId) {
    const w = await prisma.guidedWorkout.findFirst({
      where: { id: body.workoutId, userId },
      select: { id: true },
    });
    workoutId = w?.id ?? null;
  }

  const now = new Date();
  const activity = completed
    ? await prisma.activity.create({
        data: {
          userId,
          source: "manual",
          name: title,
          activityType: "WeightTraining",
          durationMin,
          startDate: now,
          startDateLocal: now,
        },
      })
    : null;

  const row = await prisma.guidedWorkoutSession.create({
    data: {
      userId,
      guidedWorkoutId: workoutId,
      title,
      startedAt,
      completed,
      bailedAtExercise,
      durationMin,
      activityId: activity?.id ?? null,
    },
  });

  if (workoutId && completed) {
    await prisma.guidedWorkout.update({
      where: { id: workoutId },
      data: { timesCompleted: { increment: 1 }, lastUsedAt: now },
    });
  }

  return NextResponse.json({ ok: true, sessionId: row.id, activityId: activity?.id ?? null }, { status: 201 });
}
