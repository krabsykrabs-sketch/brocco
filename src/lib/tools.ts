import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, format, subDays } from "date-fns";
import type Anthropic from "@anthropic-ai/sdk";
import { autoMatchActivity } from "@/lib/auto-match";

// --- Tool definitions for the Anthropic API ---

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "log_health",
    description:
      "Log a health note, injury, or observation mentioned by the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        entry_type: {
          type: "string",
          enum: ["injury", "note", "race_result", "weight"],
        },
        description: { type: "string" },
        body_part: { type: "string" },
        severity: { type: "string", enum: ["minor", "moderate", "severe"] },
        value: {
          type: "number",
          description: "For weight (kg) or race time (seconds)",
        },
      },
      required: ["entry_type", "description"],
    },
  },
  {
    name: "log_activity",
    description:
      "Log a manual activity the user did but didn't record on Strava.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "ISO date, defaults to today",
        },
        activity_type: {
          type: "string",
          enum: ["run", "cycle", "swim", "strength", "yoga", "hike", "other"],
        },
        distance_km: { type: "number" },
        duration_min: { type: "number" },
        description: { type: "string" },
        avg_pace: {
          type: "string",
          description: "Optional, e.g., '5:30/km'",
        },
        perceived_effort: {
          type: "integer",
          description: "1-10 scale",
        },
      },
      required: ["activity_type", "duration_min", "description"],
    },
  },
  {
    name: "query_data",
    description:
      "Retrieve specific historical training data not in the default context window.",
    input_schema: {
      type: "object" as const,
      properties: {
        query_type: {
          type: "string",
          enum: [
            "activities",
            "weekly_summary",
            "pace_trend",
            "heart_rate_trend",
            "workout_comparison",
          ],
        },
        filters: {
          type: "object",
          properties: {
            activity_type: { type: "string" },
            workout_type: { type: "string" },
            date_from: { type: "string" },
            date_to: { type: "string" },
            limit: { type: "integer" },
          },
        },
        description: {
          type: "string",
          description: "What you're looking for",
        },
      },
      required: ["query_type", "description"],
    },
  },
  {
    name: "adjust_plan",
    description:
      "Make reactive micro-adjustments to workouts within the current week. Auto-applied immediately, no user confirmation needed. Use for: adjusting distance/pace of upcoming sessions this week, shifting rest days within the week, reducing intensity after fatigue signals, marking a workout as covered. Do NOT use for: adding/deleting workouts, changing workout types, anything beyond 7 days out, changing weekly mileage targets or phase boundaries.",
    input_schema: {
      type: "object" as const,
      properties: {
        adjustments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              workout_id: { type: "string" },
              action: {
                type: "string",
                enum: ["update_targets", "swap_rest_day", "mark_covered"],
              },
              updates: {
                type: "object",
                description:
                  "Fields to change (distance, pace, duration)",
              },
              reason: { type: "string" },
            },
          },
        },
        summary: {
          type: "string",
          description: "Human-readable summary for dashboard notification",
        },
      },
      required: ["adjustments", "summary"],
    },
  },
  {
    name: "modify_plan",
    description:
      "Propose structural changes to the training plan. Requires user confirmation. Use for: adding/deleting workouts, changing workout types, moving workouts across weeks, modifying weekly mileage targets or phase boundaries, any change beyond 7 days out.",
    input_schema: {
      type: "object" as const,
      properties: {
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["update", "skip", "add", "delete"],
              },
              workout_id: {
                type: "string",
                description: "For update/skip/delete",
              },
              date: {
                type: "string",
                description: "For add (ISO date)",
              },
              updates: {
                type: "object",
                description: "Fields to change",
              },
              reason: { type: "string" },
            },
          },
        },
        summary: {
          type: "string",
          description: "Human-readable summary of all changes",
        },
      },
      required: ["changes", "summary"],
    },
  },
  {
    name: "save_profile",
    description:
      "Save structured profile data and coaching notes. Used during onboarding interview and when users share new info in regular chat. Typed fields update user_profiles columns. coaching_notes_update is deep-merged into existing coaching_notes jsonb.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        years_running: { type: "integer" },
        weekly_km_baseline: { type: "number" },
        goal_race: { type: "string" },
        goal_race_date: {
          type: "string",
          description: "ISO date",
        },
        goal_time: { type: "string" },
        timezone: {
          type: "string",
          description: "IANA timezone",
        },
        coaching_notes_update: {
          type: "object",
          description:
            "Partial update deep-merged into coaching_notes. Can include: injury_history, preferences, nutrition, race_history, training_history_summary, other.",
        },
      },
    },
  },
  {
    name: "generate_plan",
    description:
      "Generate a complete periodized training plan. Use when the user asks to create a new plan from scratch. Creates phases (base, build, peak, taper) and individual workouts for each day. Requires user confirmation before activation. Plan dates should start from next Monday. Each workout needs a date, type, distance/pace targets, and description. Use workout_type values: easy, long, tempo, interval, race_pace, recovery, rest, cross_training, strength, race. Use activity_type values: run, cycle, swim, hike, strength, rest, other.",
    input_schema: {
      type: "object" as const,
      properties: {
        plan_name: {
          type: "string",
          description: "e.g., 'Valencia Marathon 2026'",
        },
        goal: {
          type: "string",
          description: "e.g., 'Sub 3:00'",
        },
        race_date: {
          type: "string",
          description: "ISO date of the race",
        },
        start_date: {
          type: "string",
          description: "ISO date, plan start (should be a Monday)",
        },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "e.g., 'Base Building'" },
              description: { type: "string" },
              start_week: { type: "integer" },
              end_week: { type: "integer" },
            },
            required: ["name", "start_week", "end_week"],
          },
        },
        workouts: {
          type: "array",
          description: "All workouts in the plan. Include rest days.",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "ISO date" },
              week_number: { type: "integer" },
              title: { type: "string", description: "e.g., 'Easy Run'" },
              workout_type: {
                type: "string",
                enum: ["easy", "long", "tempo", "interval", "race_pace", "recovery", "rest", "cross_training", "strength", "race"],
              },
              activity_type: {
                type: "string",
                enum: ["run", "cycle", "swim", "hike", "strength", "rest", "other"],
                description: "Defaults to 'run'",
              },
              target_distance_km: { type: "number" },
              target_pace: { type: "string", description: "e.g., '4:15-4:30/km'" },
              target_duration_min: { type: "integer" },
              description: { type: "string" },
            },
            required: ["date", "week_number", "title", "workout_type"],
          },
        },
        summary: {
          type: "string",
          description: "Human-readable summary of the plan",
        },
      },
      required: ["plan_name", "goal", "race_date", "start_date", "phases", "workouts", "summary"],
    },
  },
  {
    name: "add_weekly_tasks",
    description:
      "Add weekly tasks (non-run activities) to the training plan. Use for strength work, mobility, nutrition reminders, recovery protocols. These appear as a checklist the user can tick off. Only works when an active plan exists.",
    input_schema: {
      type: "object" as const,
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              week_number: { type: "integer", description: "Which week of the plan" },
              description: { type: "string", description: "e.g., '2x lower body strength (squats, lunges, calf raises)'" },
              category: {
                type: "string",
                enum: ["strength", "mobility", "nutrition", "recovery", "other"],
              },
            },
            required: ["week_number", "description", "category"],
          },
        },
      },
      required: ["tasks"],
    },
  },
];

// --- Tool handlers ---

interface ToolResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  // Sent to client as a notification
  notification?: {
    type: string;
    message: string;
    data?: Record<string, unknown>;
  };
}

export async function handleToolCall(
  toolName: string,
  input: Record<string, unknown>,
  userId: string,
  chatMessageId?: string
): Promise<ToolResult> {
  switch (toolName) {
    case "log_health":
      return handleLogHealth(input, userId);
    case "log_activity":
      return handleLogActivity(input, userId);
    case "query_data":
      return handleQueryData(input, userId);
    case "adjust_plan":
      return handleAdjustPlan(input, userId);
    case "modify_plan":
      return handleModifyPlan(input, userId, chatMessageId);
    case "save_profile":
      return handleSaveProfile(input, userId);
    case "generate_plan":
      return handleGeneratePlan(input, userId, chatMessageId);
    case "add_weekly_tasks":
      return handleAddWeeklyTasks(input, userId);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// --- log_health ---

async function handleLogHealth(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const entry = await prisma.healthLog.create({
    data: {
      userId,
      date: new Date(),
      entryType: input.entry_type as "injury" | "note" | "race_result" | "weight",
      description: input.description as string,
      bodyPart: (input.body_part as string) || null,
      severity: (input.severity as "minor" | "moderate" | "severe") || null,
      value: input.value ? Number(input.value) : null,
      status: "active",
    },
  });

  const sevLabel = input.severity ? `, ${input.severity}` : "";
  const bpLabel = input.body_part ? ` ${input.body_part}` : "";
  const msg = `Logged:${bpLabel} ${input.description}${sevLabel}`;

  return {
    success: true,
    data: { id: entry.id, entryType: entry.entryType, description: entry.description },
    notification: {
      type: "health_logged",
      message: msg,
      data: {
        id: entry.id,
        entryType: entry.entryType,
        description: entry.description,
        bodyPart: entry.bodyPart,
        severity: entry.severity,
      },
    },
  };
}

// --- log_activity ---

async function handleLogActivity(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const activityType = input.activity_type as string;
  const dateStr = input.date as string | undefined;
  const date = dateStr ? new Date(dateStr) : new Date();
  const durationMin = Number(input.duration_min);
  const distanceKm = input.distance_km ? Number(input.distance_km) : null;
  const description = input.description as string;

  // Parse pace if provided
  let paceSecondsPerKm: number | null = null;
  let avgPacePerKm: string | null = (input.avg_pace as string) || null;
  if (avgPacePerKm) {
    const parts = avgPacePerKm.replace("/km", "").split(":");
    if (parts.length === 2) {
      paceSecondsPerKm = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
  } else if (distanceKm && distanceKm > 0) {
    paceSecondsPerKm = Math.round((durationMin * 60) / distanceKm);
    const mins = Math.floor(paceSecondsPerKm / 60);
    const secs = paceSecondsPerKm % 60;
    avgPacePerKm = `${mins}:${secs.toString().padStart(2, "0")}/km`;
  }

  // Map activity types to display names
  const typeMap: Record<string, string> = {
    run: "Run",
    cycle: "Ride",
    swim: "Swim",
    strength: "WeightTraining",
    yoga: "Yoga",
    hike: "Hike",
    other: "Workout",
  };

  const activity = await prisma.activity.create({
    data: {
      userId,
      source: "manual",
      name: description,
      activityType: typeMap[activityType] || "Workout",
      distanceKm: distanceKm,
      durationMin: durationMin,
      avgPacePerKm,
      paceSecondsPerKm,
      perceivedEffort: input.perceived_effort ? Number(input.perceived_effort) : null,
      startDate: date,
      startDateLocal: date,
    },
  });

  // Auto-match to planned workout
  const matchedWorkoutId = await autoMatchActivity(activity.id, userId);

  return {
    success: true,
    data: {
      id: activity.id,
      name: activity.name,
      activityType: activity.activityType,
      matchedWorkoutId,
    },
    notification: {
      type: "activity_logged",
      message: `Logged: ${description}${distanceKm ? ` (${distanceKm}km)` : ""}${matchedWorkoutId ? " (matched to plan)" : ""}`,
      data: { id: activity.id },
    },
  };
}

// --- query_data ---

async function handleQueryData(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const queryType = input.query_type as string;
  const filters = (input.filters as Record<string, unknown>) || {};
  const dateFrom = filters.date_from
    ? new Date(filters.date_from as string)
    : subDays(new Date(), 90);
  const dateTo = filters.date_to
    ? new Date(filters.date_to as string)
    : new Date();
  const limit = (filters.limit as number) || 20;

  switch (queryType) {
    case "activities": {
      const where: Record<string, unknown> = {
        userId,
        startDateLocal: { gte: dateFrom, lte: dateTo },
      };
      if (filters.activity_type) {
        where.activityType = filters.activity_type;
      }
      const activities = await prisma.activity.findMany({
        where,
        orderBy: { startDateLocal: "desc" },
        take: limit,
        select: {
          name: true,
          activityType: true,
          distanceKm: true,
          durationMin: true,
          avgPacePerKm: true,
          avgHeartRate: true,
          elevationGainM: true,
          perceivedEffort: true,
          startDateLocal: true,
          source: true,
        },
      });
      return {
        success: true,
        data: {
          activities: activities.map((a) => ({
            ...a,
            distanceKm: a.distanceKm ? Number(a.distanceKm) : null,
            durationMin: Number(a.durationMin),
            elevationGainM: a.elevationGainM ? Number(a.elevationGainM) : null,
            date: format(new Date(a.startDateLocal), "yyyy-MM-dd"),
          })),
        },
      };
    }
    case "weekly_summary": {
      const weekStart = startOfWeek(dateFrom, { weekStartsOn: 1 });
      const activities = await prisma.activity.findMany({
        where: {
          userId,
          startDateLocal: { gte: weekStart, lte: dateTo },
        },
        select: {
          activityType: true,
          distanceKm: true,
          durationMin: true,
          startDateLocal: true,
        },
      });

      const weeks: Record<string, { km: number; hours: number; count: number }> = {};
      for (const a of activities) {
        const ws = format(
          startOfWeek(new Date(a.startDateLocal), { weekStartsOn: 1 }),
          "yyyy-MM-dd"
        );
        if (!weeks[ws]) weeks[ws] = { km: 0, hours: 0, count: 0 };
        weeks[ws].km += a.distanceKm ? Number(a.distanceKm) : 0;
        weeks[ws].hours += Number(a.durationMin) / 60;
        weeks[ws].count++;
      }

      return {
        success: true,
        data: {
          weeks: Object.entries(weeks)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([week, data]) => ({
              week,
              km: Math.round(data.km * 10) / 10,
              hours: Math.round(data.hours * 10) / 10,
              sessions: data.count,
            })),
        },
      };
    }
    case "pace_trend": {
      const runs = await prisma.activity.findMany({
        where: {
          userId,
          startDateLocal: { gte: dateFrom, lte: dateTo },
          activityType: { in: ["Run", "TrailRun", "VirtualRun"] },
          paceSecondsPerKm: { not: null },
        },
        orderBy: { startDateLocal: "asc" },
        take: limit,
        select: {
          name: true,
          avgPacePerKm: true,
          paceSecondsPerKm: true,
          distanceKm: true,
          startDateLocal: true,
        },
      });
      return {
        success: true,
        data: {
          runs: runs.map((r) => ({
            date: format(new Date(r.startDateLocal), "yyyy-MM-dd"),
            name: r.name,
            pace: r.avgPacePerKm,
            paceSeconds: r.paceSecondsPerKm,
            distanceKm: r.distanceKm ? Number(r.distanceKm) : null,
          })),
        },
      };
    }
    case "heart_rate_trend": {
      const runs = await prisma.activity.findMany({
        where: {
          userId,
          startDateLocal: { gte: dateFrom, lte: dateTo },
          avgHeartRate: { not: null },
        },
        orderBy: { startDateLocal: "asc" },
        take: limit,
        select: {
          name: true,
          activityType: true,
          avgHeartRate: true,
          maxHeartRate: true,
          avgPacePerKm: true,
          startDateLocal: true,
        },
      });
      return {
        success: true,
        data: {
          activities: runs.map((r) => ({
            date: format(new Date(r.startDateLocal), "yyyy-MM-dd"),
            name: r.name,
            type: r.activityType,
            avgHR: r.avgHeartRate,
            maxHR: r.maxHeartRate,
            pace: r.avgPacePerKm,
          })),
        },
      };
    }
    case "workout_comparison": {
      const runs = await prisma.activity.findMany({
        where: {
          userId,
          startDateLocal: { gte: dateFrom, lte: dateTo },
          activityType: { in: ["Run", "TrailRun", "VirtualRun"] },
        },
        orderBy: { startDateLocal: "asc" },
        select: {
          name: true,
          activityType: true,
          distanceKm: true,
          durationMin: true,
          avgPacePerKm: true,
          paceSecondsPerKm: true,
          avgHeartRate: true,
          elevationGainM: true,
          startDateLocal: true,
        },
      });
      return {
        success: true,
        data: {
          runs: runs.map((r) => ({
            date: format(new Date(r.startDateLocal), "yyyy-MM-dd"),
            name: r.name,
            distanceKm: r.distanceKm ? Number(r.distanceKm) : null,
            durationMin: Number(r.durationMin),
            pace: r.avgPacePerKm,
            avgHR: r.avgHeartRate,
            elevationM: r.elevationGainM ? Number(r.elevationGainM) : null,
          })),
        },
      };
    }
    default:
      return { success: false, error: `Unknown query type: ${queryType}` };
  }
}

// --- adjust_plan ---

async function handleAdjustPlan(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const adjustments = (input.adjustments || []) as Array<{
    workout_id: string;
    action: string;
    updates?: Record<string, unknown>;
    reason: string;
  }>;
  const summary = input.summary as string;

  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return { success: false, error: "No adjustments provided" };
  }

  const results: Array<{ workoutId: string; action: string; success: boolean }> = [];

  for (const adj of adjustments) {
    const workout = await prisma.plannedWorkout.findFirst({
      where: { id: adj.workout_id, plan: { userId, status: "active" } },
    });

    if (!workout) {
      results.push({ workoutId: adj.workout_id, action: adj.action, success: false });
      continue;
    }

    const beforeState = {
      targetDistanceKm: workout.targetDistanceKm ? Number(workout.targetDistanceKm) : null,
      targetPace: workout.targetPace,
      targetDurationMin: workout.targetDurationMin,
      status: workout.status,
    };

    const updateData: Record<string, unknown> = {};
    if (adj.action === "update_targets" && adj.updates) {
      if (adj.updates.distance !== undefined) updateData.targetDistanceKm = Number(adj.updates.distance);
      if (adj.updates.pace !== undefined) updateData.targetPace = String(adj.updates.pace);
      if (adj.updates.duration !== undefined) updateData.targetDurationMin = Number(adj.updates.duration);
      updateData.status = "modified";
    } else if (adj.action === "mark_covered") {
      updateData.status = "completed";
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.plannedWorkout.update({
        where: { id: adj.workout_id },
        data: updateData,
      });
    }

    const afterState = {
      ...beforeState,
      ...updateData,
    };

    await prisma.planAdjustmentLog.create({
      data: {
        userId,
        workoutId: adj.workout_id,
        action: adj.action as "update_targets" | "swap_rest_day" | "mark_covered",
        beforeState,
        afterState,
        reason: adj.reason || summary,
        summary,
      },
    });

    results.push({ workoutId: adj.workout_id, action: adj.action, success: true });
  }

  return {
    success: true,
    data: { adjustments: results },
    notification: {
      type: "plan_adjusted",
      message: summary,
      data: { results },
    },
  };
}

// --- modify_plan ---

async function handleModifyPlan(
  input: Record<string, unknown>,
  userId: string,
  chatMessageId?: string
): Promise<ToolResult> {
  const changes = (input.changes || []) as Array<Record<string, unknown>>;
  const summary = String(input.summary || "Plan changes proposed by Brocco");

  if (!Array.isArray(changes) || changes.length === 0) {
    return { success: false, error: "No changes provided" };
  }

  if (!chatMessageId) {
    return { success: false, error: "Chat message ID required for plan modifications" };
  }

  const pendingChange = await prisma.pendingPlanChange.create({
    data: {
      userId,
      chatMessageId,
      changes: changes as unknown as object,
      summary,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  return {
    success: true,
    data: {
      pendingChangeId: pendingChange.id,
      summary,
      expiresAt: pendingChange.expiresAt.toISOString(),
    },
    notification: {
      type: "plan_change_proposed",
      message: summary,
      data: {
        pendingChangeId: pendingChange.id,
        summary,
        changes,
      },
    },
  };
}

// --- generate_plan ---

async function handleGeneratePlan(
  input: Record<string, unknown>,
  userId: string,
  chatMessageId?: string
): Promise<ToolResult> {
  const planName = input.plan_name as string;
  const goal = input.goal as string;
  const raceDate = input.race_date as string;
  const startDate = input.start_date as string;
  const phases = (input.phases || []) as Array<{
    name: string;
    description?: string;
    start_week: number;
    end_week: number;
  }>;
  const workouts = (input.workouts || []) as Array<{
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
  const summary = String(input.summary || `New plan: ${planName || "Training plan"}`);

  if (!Array.isArray(workouts) || workouts.length === 0) {
    return {
      success: false,
      error: "The workouts array is empty. You must include all individual workouts with dates, types, and targets. Try generating the plan again, making sure to include the full workouts array.",
    };
  }

  if (!Array.isArray(phases) || phases.length === 0) {
    return {
      success: false,
      error: "The phases array is empty. You must include at least one phase (e.g., base, build, peak, taper). Try again.",
    };
  }

  // Store as pending change with plan generation data
  const changePayload = {
    type: "generate_plan",
    plan_name: planName,
    goal,
    race_date: raceDate,
    start_date: startDate,
    phases,
    workouts,
  };

  // We need a chatMessageId to link the pending change
  // If not available, create a placeholder
  if (!chatMessageId) {
    return {
      success: false,
      error: "Chat message ID required for plan generation",
    };
  }

  const pendingChange = await prisma.pendingPlanChange.create({
    data: {
      userId,
      chatMessageId,
      changes: changePayload as unknown as object,
      summary,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  return {
    success: true,
    data: {
      pendingChangeId: pendingChange.id,
      summary,
      planName,
      totalWorkouts: workouts.length,
      totalPhases: phases.length,
      weeksCount: phases.length > 0 ? phases[phases.length - 1].end_week : 0,
      expiresAt: pendingChange.expiresAt.toISOString(),
    },
    notification: {
      type: "plan_change_proposed",
      message: `New plan: ${planName} — ${summary}`,
      data: {
        pendingChangeId: pendingChange.id,
        summary,
        planName,
        totalWorkouts: workouts.length,
        totalPhases: phases.length,
      },
    },
  };
}

// --- add_weekly_tasks ---

async function handleAddWeeklyTasks(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const tasks = (input.tasks || []) as Array<{
    week_number: number;
    description: string;
    category: string;
  }>;

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { success: false, error: "No tasks provided" };
  }

  const activePlan = await prisma.plan.findFirst({
    where: { userId, status: "active" },
    select: { id: true },
  });

  if (!activePlan) {
    return { success: false, error: "No active plan. Create a plan first." };
  }

  const validCategories = ["strength", "mobility", "nutrition", "recovery", "other"];
  const taskData = tasks.map((t) => ({
    planId: activePlan.id,
    weekNumber: t.week_number,
    description: t.description,
    category: (validCategories.includes(t.category) ? t.category : "other") as "strength" | "mobility" | "nutrition" | "recovery" | "other",
    status: "pending" as const,
  }));

  await prisma.weeklyTask.createMany({ data: taskData });

  return {
    success: true,
    data: { tasksCreated: taskData.length },
    notification: {
      type: "tasks_added",
      message: `Added ${taskData.length} weekly task${taskData.length > 1 ? "s" : ""} to your plan`,
    },
  };
}

// --- save_profile ---

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const tVal = target[key];
    const sVal = source[key];
    if (
      tVal && sVal &&
      typeof tVal === "object" && !Array.isArray(tVal) &&
      typeof sVal === "object" && !Array.isArray(sVal)
    ) {
      result[key] = deepMerge(tVal as Record<string, unknown>, sVal as Record<string, unknown>);
    } else {
      result[key] = sVal;
    }
  }
  return result;
}

async function handleSaveProfile(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) {
    return { success: false, error: "User profile not found" };
  }

  // Build update data for typed columns
  const updateData: Record<string, unknown> = {};
  const savedFields: string[] = [];

  if (input.name !== undefined) {
    // Update user name, not profile
    await prisma.user.update({ where: { id: userId }, data: { name: input.name as string } });
    savedFields.push("name");
  }
  if (input.years_running !== undefined) {
    updateData.yearsRunning = Number(input.years_running);
    savedFields.push("years_running");
  }
  if (input.weekly_km_baseline !== undefined) {
    updateData.weeklyKmBaseline = Number(input.weekly_km_baseline);
    savedFields.push("weekly_km_baseline");
  }
  if (input.goal_race !== undefined) {
    updateData.goalRace = input.goal_race as string;
    savedFields.push("goal_race");
  }
  if (input.goal_race_date !== undefined) {
    updateData.goalRaceDate = new Date(input.goal_race_date as string);
    savedFields.push("goal_race_date");
  }
  if (input.goal_time !== undefined) {
    updateData.goalTime = input.goal_time as string;
    savedFields.push("goal_time");
  }
  if (input.timezone !== undefined) {
    updateData.timezone = input.timezone as string;
    savedFields.push("timezone");
  }

  // Deep-merge coaching_notes_update into existing coaching_notes
  if (input.coaching_notes_update && typeof input.coaching_notes_update === "object") {
    const existing = (profile.coachingNotes as Record<string, unknown>) || {};
    updateData.coachingNotes = deepMerge(existing, input.coaching_notes_update as Record<string, unknown>);
    savedFields.push("coaching_notes");
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.userProfile.update({
      where: { userId },
      data: updateData,
    });
  }

  return {
    success: true,
    data: { saved_fields: savedFields },
    notification: {
      type: "profile_updated",
      message: `Profile updated: ${savedFields.join(", ")}`,
    },
  };
}
