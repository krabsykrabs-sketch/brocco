import { prisma } from "@/lib/db";
import type { WorkoutType, ActivityKind, WeekDetailLevel, WorkoutDetailLevel } from "@prisma/client";

export async function applyPlanGeneration(
  userId: string,
  payload: Record<string, unknown>
) {
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
    steps?: unknown;
  }>;

  const lastWeek = planWeeks.length > 0
    ? planWeeks.reduce((latest, w) => w.start_date > latest ? w.start_date : latest, planWeeks[0].start_date)
    : raceDate || startDate;
  const endDateObj = new Date(lastWeek);
  endDateObj.setDate(endDateObj.getDate() + 6);

  // One transaction: if any step fails, the old plan stays active and no
  // partial new plan exists — re-approving after a failure is then safe.
  const plan = await prisma.$transaction(async (tx) => {
    // Deactivate any existing active plan (inside the tx so a failure
    // later in generation leaves the old plan untouched and active)
    await tx.plan.updateMany({
      where: { userId, status: "active" },
      data: { status: "completed" },
    });

    const created = await tx.plan.create({
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
      const phase = await tx.planPhase.create({
        data: {
          planId: created.id,
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
      await tx.planWeek.createMany({
        data: planWeeks.map((pw) => ({
          planId: created.id,
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
    await tx.plannedWorkout.createMany({
      data: workouts.map((w) => ({
        planId: created.id,
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
        steps: w.steps ?? undefined,
        status: "planned" as const,
      })),
    });

    if (raceDate) {
      await tx.userProfile.update({
        where: { userId },
        data: {
          goalRace: planName,
          goalRaceDate: new Date(raceDate),
          goalTime: goal,
        },
      });
    }

    return created;
  });

  return { planId: plan.id, planName: plan.name };
}

// Keys `update` actually writes. Anything else is rejected rather than
// dropped, so a caller never gets a success for a change that didn't happen.
// The model reliably emits field names borrowed from generate_plan's schema
// (target_distance_km) or from natural phrasing (distance_km) rather than the
// short names these tools document. Rejecting those is honest but useless —
// the user's change still doesn't happen. Accept every spelling that has one
// unambiguous meaning, and reject only genuinely unknown keys.
const UPDATE_ALIASES: Record<string, string> = {
  distance: "distance",
  distance_km: "distance",
  target_distance_km: "distance",
  km: "distance",
  pace: "pace",
  target_pace: "pace",
  duration: "duration",
  duration_min: "duration",
  target_duration_min: "duration",
  date: "date",
  new_date: "date",
  title: "title",
  description: "description",
  steps: "steps",
  workout_type: "workout_type",
  type: "workout_type",
  activity_type: "activity_type",
  sport: "activity_type",
  swap_with_workout_id: "swap_with_workout_id",
};

/**
 * Maps whatever spelling the model used onto canonical field names, keeping
 * only those the caller supports. `unknown` holds keys with no meaning here,
 * which callers reject rather than silently drop.
 */
export function normalizeUpdates(
  updates: Record<string, unknown> | undefined,
  allowed: string[]
): { values: Record<string, unknown>; unknown: string[] } {
  const values: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [key, value] of Object.entries(updates || {})) {
    const canonical = UPDATE_ALIASES[key];
    if (!canonical || !allowed.includes(canonical)) {
      unknown.push(key);
      continue;
    }
    values[canonical] = value;
  }
  return { values, unknown };
}

/** Canonical fields `update` can write. */
const UPDATABLE = [
  "distance",
  "pace",
  "duration",
  "workout_type",
  "title",
  "description",
  "steps",
  "date",
];

/** Keys `add` actually writes. Same contract as UPDATABLE: reject, never drop. */
const ADDABLE = [
  "title",
  "workout_type",
  "activity_type",
  "distance",
  "pace",
  "duration",
  "description",
  "steps",
];

type WeekLookup =
  | { kind: "resolved"; weekNumber: number }
  | { kind: "no_weeks" } // legacy plan with no PlanWeek rows — UI groups by the workout's own weekNumber
  | { kind: "outside" }; // date falls outside every week of the plan

/**
 * Plan week containing `date`, so a moved workout keeps a correct weekNumber.
 * Scoped to the workout's OWN plan, not the active one — modifying a workout on
 * an archived plan must not stamp it with the active plan's week numbers.
 *
 * Matches the LAST overlapping week, exactly as the Plan tab does
 * (plan/page.tsx findLastIndex): a partial "Week 0" from a mid-week start spans
 * fewer than 7 days, so its naive +6 range can overlap Week 1's Monday, and the
 * last match resolves that in Week 1's favour. Resolving it the other way here
 * would file the workout under a different week than the UI displays it in.
 */
export async function weekNumberForDate(planId: string, date: Date): Promise<WeekLookup> {
  const weeks = await prisma.planWeek.findMany({
    where: { planId },
    orderBy: { weekNumber: "asc" },
    select: { weekNumber: true, startDate: true },
  });
  if (weeks.length === 0) return { kind: "no_weeks" };

  let match: number | null = null;
  for (const w of weeks) {
    const start = new Date(w.startDate);
    const end = new Date(start.getTime() + 6 * 86400000);
    if (date >= start && date <= end) match = w.weekNumber;
  }
  return match === null ? { kind: "outside" } : { kind: "resolved", weekNumber: match };
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
  const results: Array<{
    action: string;
    workoutId?: string;
    success: boolean;
    error?: string;
  }> = [];

  const notFound =
    "No workout with that id on this user's plan. The workout_id is wrong or stale — re-read the plan context and use an id listed there.";

  for (const c of changes) {
    // workout_id values come from LLM tool output — never trust them alone.
    // Every mutation is scoped through the plan's userId; count===0 means
    // the workout doesn't exist OR belongs to someone else, either way a no-op.
    if (c.action === "update" && c.workout_id) {
      // An unrecognised key means the caller asked for something this action
      // cannot do. Silently dropping it applies part of the requested change
      // and reports it as fully done — reject the whole change instead.
      const norm = normalizeUpdates(c.updates, UPDATABLE);
      const unknown = norm.unknown;
      if (unknown.length > 0) {
        results.push({
          action: "update",
          workoutId: c.workout_id,
          success: false,
          error: `update does not support ${unknown
            .map((k) => `\`${k}\``)
            .join(", ")}. Nothing was changed. Supported: ${UPDATABLE.join(", ")}.`,
        });
        continue;
      }

      const u = norm.values;
      const updateData: Record<string, unknown> = {};
      {
        if (u.distance !== undefined) updateData.targetDistanceKm = Number(u.distance);
        if (u.pace !== undefined) updateData.targetPace = String(u.pace);
        if (u.duration !== undefined) updateData.targetDurationMin = Number(u.duration);
        if (u.workout_type !== undefined) updateData.workoutType = u.workout_type;
        if (u.title !== undefined) updateData.title = u.title;
        if (u.description !== undefined) updateData.description = u.description;
        if (u.steps !== undefined) updateData.steps = u.steps;
        // modify_plan's whole purpose includes "moving workouts across weeks",
        // so `date` has to actually move the row — and carry week_number with
        // it, or the workout lands in the right day but the wrong plan week.
        if (u.date !== undefined) {
          const newDate = new Date(String(u.date));
          if (Number.isNaN(newDate.getTime())) {
            results.push({
              action: "update",
              workoutId: c.workout_id,
              success: false,
              error: `"${String(u.date)}" is not a valid ISO date. Nothing was changed.`,
            });
            continue;
          }
          const existing = await prisma.plannedWorkout.findFirst({
            where: { id: c.workout_id, plan: { userId } },
            select: { planId: true },
          });
          if (!existing) {
            results.push({ action: "update", workoutId: c.workout_id, success: false, error: notFound });
            continue;
          }
          const week = await weekNumberForDate(existing.planId, newDate);
          // Moving a workout outside every week of the plan would leave it
          // filed under a week it no longer falls in — the Plan tab groups
          // strictly by weekNumber, so it would vanish from the view.
          if (week.kind === "outside") {
            results.push({
              action: "update",
              workoutId: c.workout_id,
              success: false,
              error: `${String(u.date)} falls outside every week of this plan, so the workout would not show up anywhere. Nothing was changed.`,
            });
            continue;
          }
          updateData.date = newDate;
          if (week.kind === "resolved") updateData.weekNumber = week.weekNumber;
        }
      }
      updateData.status = "modified";
      const { count } = await prisma.plannedWorkout.updateMany({
        where: { id: c.workout_id, plan: { userId } },
        data: updateData,
      });
      results.push({
        action: "update",
        workoutId: c.workout_id,
        success: count > 0,
        error: count > 0 ? undefined : notFound,
      });
    } else if (c.action === "skip" && c.workout_id) {
      const { count } = await prisma.plannedWorkout.updateMany({
        where: { id: c.workout_id, plan: { userId } },
        data: { status: "skipped" },
      });
      results.push({
        action: "skip",
        workoutId: c.workout_id,
        success: count > 0,
        error: count > 0 ? undefined : notFound,
      });
    } else if (c.action === "delete" && c.workout_id) {
      const { count } = await prisma.plannedWorkout.deleteMany({
        where: { id: c.workout_id, plan: { userId } },
      });
      results.push({
        action: "delete",
        workoutId: c.workout_id,
        success: count > 0,
        error: count > 0 ? undefined : notFound,
      });
    } else if (c.action === "add" && c.date) {
      const plan = await prisma.plan.findFirst({ where: { userId, status: "active" } });
      if (!plan) {
        results.push({ action: "add", success: false, error: "No active plan to add a workout to." });
      } else if (!c.updates) {
        results.push({
          action: "add",
          success: false,
          error: "add needs an `updates` object describing the workout (title, workout_type, distance, ...).",
        });
      } else {
        const normAdd = normalizeUpdates(c.updates, ADDABLE);
        const unknownAdd = normAdd.unknown;
        if (unknownAdd.length > 0) {
          results.push({
            action: "add",
            success: false,
            error: `add does not support ${unknownAdd
              .map((k) => `\`${k}\``)
              .join(", ")}. Nothing was created. Supported: ${ADDABLE.join(", ")}.`,
          });
          continue;
        }

        const addDate = new Date(c.date);
        if (Number.isNaN(addDate.getTime())) {
          results.push({ action: "add", success: false, error: `"${c.date}" is not a valid ISO date.` });
          continue;
        }

        // weekNumber was hard-coded to 0. The Plan tab groups strictly by
        // weekNumber against the plan's PlanWeek rows, so a week-0 workout on
        // a plan with no Week 0 rendered nowhere — created successfully,
        // reported as done, and invisible to the user.
        const week = await weekNumberForDate(plan.id, addDate);
        if (week.kind === "outside") {
          results.push({
            action: "add",
            success: false,
            error: `${c.date} falls outside every week of this plan, so the workout would not show up anywhere. Nothing was created.`,
          });
          continue;
        }

        await prisma.plannedWorkout.create({
          data: {
            planId: plan.id,
            weekNumber: week.kind === "resolved" ? week.weekNumber : 0,
            date: addDate,
            title: (normAdd.values.title as string) || "New workout",
            workoutType: ((normAdd.values.workout_type as string) || "easy") as WorkoutType,
            // Dropping this silently turned a requested bike session into a run.
            activityType: ((normAdd.values.activity_type as string) || "run") as ActivityKind,
            targetDistanceKm: normAdd.values.distance != null ? Number(normAdd.values.distance) : null,
            targetPace: normAdd.values.pace != null ? String(normAdd.values.pace) : null,
            targetDurationMin: normAdd.values.duration != null ? Number(normAdd.values.duration) : null,
            description: normAdd.values.description != null ? String(normAdd.values.description) : null,
            steps: (normAdd.values.steps as object | undefined) ?? undefined,
          },
        });
        results.push({ action: "add", success: true });
      }
    } else {
      // Unknown action, or a known action missing its required field
      // (update/skip/delete without workout_id, add without date). Previously
      // these fell through and recorded nothing at all, so the caller saw an
      // empty result set and reported success.
      results.push({
        action: c.action,
        workoutId: c.workout_id,
        success: false,
        error:
          c.action === "add"
            ? "add needs a `date`."
            : ["update", "skip", "delete"].includes(c.action)
              ? `${c.action} needs a \`workout_id\`.`
              : `Unknown action "${c.action}".`,
      });
    }
  }

  return results;
}
