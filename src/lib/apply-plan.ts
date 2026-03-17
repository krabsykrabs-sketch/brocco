import { prisma } from "@/lib/db";
import type { WorkoutType, ActivityKind, WeekDetailLevel, WorkoutDetailLevel } from "@prisma/client";

export async function applyPlanGeneration(
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
  const planWeeks = (payload.plan_weeks || []) as Array<{
    week_number: number;
    start_date: string;
    detail_level: string;
    target_km: number;
    target_sessions: number;
    session_types?: string[];
  }>;
  const workouts = (payload.workouts || []) as Array<{
    date: string;
    week_number: number;
    title: string;
    workout_type: string;
    detail_level?: string;
    activity_type?: string;
    target_distance_km?: number;
    target_pace?: string;
    target_duration_min?: number;
    description?: string;
  }>;

  const lastWeek = planWeeks.length > 0
    ? planWeeks.reduce((latest, w) => w.start_date > latest ? w.start_date : latest, planWeeks[0].start_date)
    : raceDate || startDate;
  const endDateObj = new Date(lastWeek);
  endDateObj.setDate(endDateObj.getDate() + 6);

  const plan = await prisma.plan.create({
    data: {
      userId,
      name: planName,
      goal,
      raceDate: raceDate ? new Date(raceDate) : endDateObj,
      startDate: new Date(startDate),
      endDate: endDateObj,
      status: "active",
    },
  });

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
    for (let w = p.start_week; w <= p.end_week; w++) {
      phaseMap[String(w)] = phase.id;
    }
  }

  if (planWeeks.length > 0) {
    const validDetailLevels: WeekDetailLevel[] = ["detailed", "outline", "target"];
    await prisma.planWeek.createMany({
      data: planWeeks.map((pw) => ({
        planId: plan.id,
        phaseId: phaseMap[String(pw.week_number)] || null,
        weekNumber: pw.week_number,
        startDate: new Date(pw.start_date),
        detailLevel: (validDetailLevels.includes(pw.detail_level as WeekDetailLevel) ? pw.detail_level : "target") as WeekDetailLevel,
        targetKm: pw.target_km ?? null,
        targetSessions: pw.target_sessions ?? null,
        sessionTypes: pw.session_types || undefined,
      })),
    });
  }

  const validWorkoutDetail: WorkoutDetailLevel[] = ["detailed", "outline"];
  const workoutData = workouts.map((w) => ({
    planId: plan.id,
    phaseId: phaseMap[String(w.week_number)] || null,
    weekNumber: w.week_number,
    date: new Date(w.date),
    title: w.title,
    workoutType: (w.workout_type || "easy") as WorkoutType,
    activityType: (w.activity_type || "run") as ActivityKind,
    detailLevel: (validWorkoutDetail.includes(w.detail_level as WorkoutDetailLevel) ? w.detail_level : "detailed") as WorkoutDetailLevel,
    targetDistanceKm: w.target_distance_km ?? null,
    targetPace: w.target_pace || null,
    targetDurationMin: w.target_duration_min ?? null,
    description: w.description || null,
    status: "planned" as const,
  }));

  await prisma.plannedWorkout.createMany({ data: workoutData });

  if (raceDate) {
    await prisma.userProfile.update({
      where: { userId },
      data: {
        goalRace: planName,
        goalRaceDate: new Date(raceDate),
        goalTime: goal,
      },
    });
  }

  return { planId: plan.id, planName: plan.name };
}

export async function applyPlanModifications(
  userId: string,
  changes: Array<{
    action: string;
    workout_id?: string;
    date?: string;
    updates?: Record<string, unknown>;
    reason?: string;
  }>
) {
  const results: Array<{ action: string; success: boolean }> = [];

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
      await prisma.plannedWorkout.update({ where: { id: c.workout_id }, data: updateData });
      results.push({ action: "update", success: true });
    } else if (c.action === "skip" && c.workout_id) {
      await prisma.plannedWorkout.update({ where: { id: c.workout_id }, data: { status: "skipped" } });
      results.push({ action: "skip", success: true });
    } else if (c.action === "delete" && c.workout_id) {
      await prisma.plannedWorkout.delete({ where: { id: c.workout_id } });
      results.push({ action: "delete", success: true });
    } else if (c.action === "add" && c.date) {
      const plan = await prisma.plan.findFirst({ where: { userId, status: "active" } });
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
        results.push({ action: "add", success: true });
      }
    }
  }

  return results;
}
