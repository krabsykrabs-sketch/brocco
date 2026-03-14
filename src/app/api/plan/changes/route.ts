import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import type { WorkoutType, ActivityKind } from "@prisma/client";

// POST /api/plan/changes — Approve or reject a pending plan change
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action } = await request.json();

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json(
      { error: "id and action (approve|reject) required" },
      { status: 400 }
    );
  }

  const change = await prisma.pendingPlanChange.findFirst({
    where: { id, userId: session.userId, status: "pending" },
  });

  if (!change) {
    return NextResponse.json({ error: "Pending change not found" }, { status: 404 });
  }

  // Check expiry
  if (new Date() > change.expiresAt) {
    await prisma.pendingPlanChange.update({
      where: { id },
      data: { status: "expired", resolvedAt: new Date() },
    });
    return NextResponse.json({ error: "Change has expired" }, { status: 410 });
  }

  if (action === "reject") {
    await prisma.pendingPlanChange.update({
      where: { id },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    return NextResponse.json({ success: true, status: "rejected" });
  }

  // Check if this is a plan generation or a plan modification
  const payload = change.changes as Record<string, unknown>;

  if (payload.type === "generate_plan") {
    await applyPlanGeneration(session.userId, payload);
  } else {
    // Regular modifications
    const changes = change.changes as Array<{
      action: string;
      workout_id?: string;
      date?: string;
      updates?: Record<string, unknown>;
      reason?: string;
    }>;
    await applyPlanModifications(session.userId, changes);
  }

  await prisma.pendingPlanChange.update({
    where: { id },
    data: { status: "approved", resolvedAt: new Date() },
  });

  return NextResponse.json({ success: true, status: "approved" });
}

async function applyPlanGeneration(
  userId: string,
  payload: Record<string, unknown>
) {
  // Deactivate any existing active plan
  await prisma.plan.updateMany({
    where: { userId, status: "active" },
    data: { status: "completed" },
  });

  const planName = payload.plan_name as string;
  const goal = payload.goal as string;
  const raceDate = payload.race_date as string;
  const startDate = payload.start_date as string;
  const phases = payload.phases as Array<{
    name: string;
    description?: string;
    start_week: number;
    end_week: number;
  }>;
  const workouts = payload.workouts as Array<{
    date: string;
    week_number: number;
    title: string;
    workout_type: string;
    activity_type?: string;
    target_distance_km?: number;
    target_pace?: string;
    target_duration_min?: number;
    description?: string;
  }>;

  // Compute end date from last workout or race date
  const lastWorkoutDate = workouts.length > 0
    ? workouts.reduce((latest, w) => w.date > latest ? w.date : latest, workouts[0].date)
    : raceDate;

  // Create the plan
  const plan = await prisma.plan.create({
    data: {
      userId,
      name: planName,
      goal,
      raceDate: new Date(raceDate),
      startDate: new Date(startDate),
      endDate: new Date(lastWorkoutDate),
      status: "active",
    },
  });

  // Create phases
  const phaseMap: Record<string, string> = {};
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const phase = await prisma.planPhase.create({
      data: {
        planId: plan.id,
        name: p.name,
        orderIndex: i,
        description: p.description || null,
        startWeek: p.start_week,
        endWeek: p.end_week,
      },
    });
    // Map week ranges to phase IDs
    for (let w = p.start_week; w <= p.end_week; w++) {
      phaseMap[String(w)] = phase.id;
    }
  }

  // Create workouts in batches
  const workoutData = workouts.map((w) => ({
    planId: plan.id,
    phaseId: phaseMap[String(w.week_number)] || null,
    weekNumber: w.week_number,
    date: new Date(w.date),
    title: w.title,
    workoutType: (w.workout_type || "easy") as WorkoutType,
    activityType: (w.activity_type || "run") as ActivityKind,
    targetDistanceKm: w.target_distance_km ?? null,
    targetPace: w.target_pace || null,
    targetDurationMin: w.target_duration_min ?? null,
    description: w.description || null,
    status: "planned" as const,
  }));

  // Use createMany for efficiency
  await prisma.plannedWorkout.createMany({
    data: workoutData,
  });

  // Also update user profile goal if applicable
  await prisma.userProfile.update({
    where: { userId },
    data: {
      goalRace: planName,
      goalRaceDate: new Date(raceDate),
      goalTime: goal,
    },
  });
}

async function applyPlanModifications(
  userId: string,
  changes: Array<{
    action: string;
    workout_id?: string;
    date?: string;
    updates?: Record<string, unknown>;
    reason?: string;
  }>
) {
  for (const c of changes) {
    if (c.action === "update" && c.workout_id) {
      const updateData: Record<string, unknown> = {};
      if (c.updates) {
        if (c.updates.distance !== undefined) updateData.targetDistanceKm = Number(c.updates.distance);
        if (c.updates.pace !== undefined) updateData.targetPace = String(c.updates.pace);
        if (c.updates.duration !== undefined) updateData.targetDurationMin = Number(c.updates.duration);
        if (c.updates.workout_type !== undefined) updateData.workoutType = c.updates.workout_type;
        if (c.updates.title !== undefined) updateData.title = c.updates.title;
        if (c.updates.description !== undefined) updateData.description = c.updates.description;
      }
      updateData.status = "modified";
      await prisma.plannedWorkout.update({
        where: { id: c.workout_id },
        data: updateData,
      });
    } else if (c.action === "skip" && c.workout_id) {
      await prisma.plannedWorkout.update({
        where: { id: c.workout_id },
        data: { status: "skipped" },
      });
    } else if (c.action === "delete" && c.workout_id) {
      await prisma.plannedWorkout.delete({
        where: { id: c.workout_id },
      });
    } else if (c.action === "add" && c.date) {
      const plan = await prisma.plan.findFirst({
        where: { userId, status: "active" },
      });
      if (plan && c.updates) {
        await prisma.plannedWorkout.create({
          data: {
            planId: plan.id,
            weekNumber: 0,
            date: new Date(c.date),
            title: (c.updates.title as string) || "New workout",
            workoutType: ((c.updates.workout_type as string) || "easy") as WorkoutType,
            targetDistanceKm: c.updates.distance ? Number(c.updates.distance) : null,
            targetPace: c.updates.pace ? String(c.updates.pace) : null,
            targetDurationMin: c.updates.duration ? Number(c.updates.duration) : null,
            description: c.updates.description ? String(c.updates.description) : null,
          },
        });
      }
    }
  }
}
