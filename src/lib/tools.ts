import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, format, subDays } from "date-fns";
import type Anthropic from "@anthropic-ai/sdk";
import { applyPlanGeneration, applyPlanModifications } from "@/lib/apply-plan";

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
      "Save structured profile data and coaching notes. Used when users share personal info in chat. Typed fields update user_profiles columns. coaching_notes_update is deep-merged into existing coaching_notes jsonb.",
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
      "Generate a training plan using the rolling horizon approach. Creates phases for the full plan, plan_weeks metadata for every week, and individual workouts ONLY for weeks with detail_level 'detailed' (weeks 1-2) and 'outline' (weeks 3-4). Do NOT generate workouts for 'target' weeks (week 5+). This dramatically reduces output size. Plan dates should start from next Monday.",
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
          description: "ISO date of the race (or end date for general plans)",
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
        plan_weeks: {
          type: "array",
          description: "Metadata for EVERY week of the plan. Required for all weeks.",
          items: {
            type: "object",
            properties: {
              week_number: { type: "integer" },
              start_date: { type: "string", description: "ISO date, Monday of this week" },
              detail_level: {
                type: "string",
                enum: ["detailed", "outline", "target"],
                description: "Weeks 1-2: detailed, weeks 3-4: outline, week 5+: target",
              },
              target_km: { type: "number", description: "Target running km for the week" },
              target_sessions: { type: "integer", description: "Number of sessions planned" },
              session_types: {
                type: "array",
                items: { type: "string" },
                description: "Session type codes, e.g. ['E','E','I','E','T','L','R'] for easy/interval/tempo/long/rest",
              },
            },
            required: ["week_number", "start_date", "detail_level", "target_km", "target_sessions"],
          },
        },
        workouts: {
          type: "array",
          description: "Individual workouts ONLY for 'detailed' weeks (1-2, full specs) and 'outline' weeks (3-4, type + approximate distance only). Do NOT include workouts for 'target' weeks.",
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
              detail_level: {
                type: "string",
                enum: ["detailed", "outline"],
                description: "detailed = full specs (pace, description). outline = type + approx distance only.",
              },
              activity_type: {
                type: "string",
                enum: ["run", "cycle", "swim", "hike", "strength", "rest", "other"],
                description: "Defaults to 'run'",
              },
              target_distance_km: { type: "number" },
              target_pace: { type: "string", description: "For detailed workouts only, e.g., '4:15-4:30/km'" },
              target_duration_min: { type: "integer" },
              description: { type: "string", description: "For detailed workouts only" },
            },
            required: ["date", "week_number", "title", "workout_type"],
          },
        },
        summary: {
          type: "string",
          description: "Human-readable summary of the plan",
        },
      },
      required: ["plan_name", "goal", "start_date", "phases", "plan_weeks", "workouts", "summary"],
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
  {
    name: "manage_event",
    description:
      "Create, update, or delete calendar events. Use for appointments, meetings, social plans, travel, and birthdays. Birthdays: category 'birthday', all_day true, recurrence yearly, title like \"Anna's birthday\". For training runs, do NOT create events — workouts live in the training plan (use adjust_plan/modify_plan). Times are the user's local time.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"] },
        event_id: { type: "string", description: "Required for update/delete" },
        title: { type: "string" },
        start: {
          type: "string",
          description: "Local start: 'yyyy-MM-ddTHH:mm', or 'yyyy-MM-dd' for all-day",
        },
        end: { type: "string", description: "Local end time 'yyyy-MM-ddTHH:mm' (optional)" },
        all_day: { type: "boolean" },
        location: { type: "string" },
        notes: { type: "string" },
        category: {
          type: "string",
          enum: ["work", "family", "training", "social", "health", "birthday", "other"],
        },
        recurrence: {
          type: "object",
          description: "Optional recurrence rule",
          properties: {
            freq: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
            interval: { type: "integer", description: "Every N periods, default 1" },
            until: { type: "string", description: "Last date 'yyyy-MM-dd' (optional)" },
            count: { type: "integer", description: "Total occurrences (optional)" },
          },
        },
        reminder_minutes: { type: "integer", description: "Reminder offset before start" },
        delete_scope: {
          type: "string",
          enum: ["occurrence", "series"],
          description: "For deleting from a recurring event: one occurrence or the whole series. Default series.",
        },
        occurrence_date: {
          type: "string",
          description: "'yyyy-MM-dd' of the occurrence, required when delete_scope=occurrence",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_task",
    description:
      "Create, update, complete, or delete to-dos and task lists. Tasks can have due dates, priority, recurrence ('water plants every Sunday'), subtasks, and a list (e.g. Groceries, House). Tasks without a list land in the Inbox. Reference lists by name — they're created automatically. For multiple items ('groceries: milk, eggs, coffee') create one task per item in the right list.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "complete", "reopen", "delete", "create_list", "rename_list", "delete_list"],
        },
        task_id: { type: "string", description: "For update/complete/reopen/delete" },
        title: { type: "string" },
        notes: { type: "string" },
        due_date: { type: "string", description: "'yyyy-MM-dd' (optional)" },
        due_time: { type: "string", description: "'HH:mm' local (optional)" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        list: { type: "string", description: "List name; omit for Inbox" },
        parent_task_id: { type: "string", description: "Make this a subtask of another task" },
        subtasks: {
          type: "array",
          items: { type: "string" },
          description: "Subtask titles to create alongside (create only)",
        },
        recurrence: {
          type: "object",
          properties: {
            freq: { type: "string", enum: ["none", "daily", "weekly", "monthly", "yearly"] },
            interval: { type: "integer", description: "Every N periods, default 1" },
          },
        },
        list_id: { type: "string", description: "For rename_list/delete_list" },
        new_name: { type: "string", description: "For rename_list" },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_note",
    description:
      "Save, update, search, or delete notes — quick facts ('locker code is 4821'), lists (packing list), reference info. Use search before answering questions about previously stored facts. 'append' adds text to an existing note's body.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["create", "update", "append", "search", "delete"] },
        note_id: { type: "string", description: "For update/append/delete" },
        title: { type: "string" },
        body: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        query: { type: "string", description: "Search text (action=search) — matches title, body, tags" },
      },
      required: ["action"],
    },
  },
  {
    name: "query_schedule",
    description:
      "Read the unified schedule — calendar events, planned workouts from the training plan, and due tasks — for a date range. Use to answer 'what does my Thursday look like', to find free slots, and ALWAYS before scheduling something new, so you can flag conflicts (e.g. a long run colliding with an early flight).",
    input_schema: {
      type: "object" as const,
      properties: {
        date_from: { type: "string", description: "'yyyy-MM-dd'" },
        date_to: { type: "string", description: "'yyyy-MM-dd' (inclusive)" },
        include_overdue_tasks: { type: "boolean", description: "Also list overdue open tasks. Default true." },
      },
      required: ["date_from", "date_to"],
    },
  },
  {
    name: "log_journal",
    description:
      "Log the user's mood and private diary entries, or read recent ones. Use action 'log' whenever the user shares how they feel ('feeling flat today', 'so happy after that race') or reflects on their day — mood is 1 (rough) to 5 (great), text captures their reflection in their own words. Mood and text can be logged together or alone. Use action 'recent' before answering questions about how they've been feeling lately. This is a private diary — do NOT store facts or reference info here (use manage_note for that).",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["log", "recent"] },
        mood: { type: "integer", description: "1 (rough) to 5 (great)" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Context tags, e.g. ['training', 'work', 'sleep']",
        },
        text: { type: "string", description: "The reflection/diary text, close to the user's own words" },
        days: { type: "integer", description: "For 'recent': how many days back to read. Default 14." },
      },
      required: ["action"],
    },
  },
];

// --- Feature-gated tool selection ---

import type { Features } from "@/lib/features";

const TOOL_FEATURE_GATES: Record<string, (f: Features) => boolean> = {
  manage_event: (f) => f.calendar,
  manage_task: (f) => f.tasks,
  manage_note: (f) => f.notes,
  query_schedule: (f) => f.calendar || f.tasks,
  log_journal: (f) => f.journal,
};

/**
 * The tool set Brocco gets for a request, respecting the user's feature
 * toggles — with everything disabled this is exactly the classic coaching
 * tool set, so Brocco can't create events/tasks/notes the user opted out of.
 */
export function toolsForFeatures(features: Features): Anthropic.Tool[] {
  return toolDefinitions.filter((t) => {
    const gate = TOOL_FEATURE_GATES[t.name];
    return gate ? gate(features) : true;
  });
}

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
    case "manage_event":
      return handleManageEvent(input, userId);
    case "manage_task":
      return handleManageTask(input, userId);
    case "manage_note":
      return handleManageNote(input, userId);
    case "query_schedule":
      return handleQuerySchedule(input, userId);
    case "log_journal":
      return handleLogJournal(input, userId);
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

  return {
    success: true,
    data: {
      id: activity.id,
      name: activity.name,
      activityType: activity.activityType,
    },
    notification: {
      type: "activity_logged",
      message: `Logged: ${description}${distanceKm ? ` (${distanceKm}km)` : ""}`,
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
  const changes = (input.changes || []) as Array<{
    action: string;
    workout_id?: string;
    date?: string;
    updates?: Record<string, unknown>;
    reason?: string;
  }>;
  const summary = String(input.summary || "Plan changes applied by Brocco");

  if (!Array.isArray(changes) || changes.length === 0) {
    return { success: false, error: "No changes provided" };
  }

  // Apply changes directly (Brocco should have asked for verbal confirmation first)
  const results = await applyPlanModifications(userId, changes);

  return {
    success: true,
    data: { modifications: results, summary },
    notification: {
      type: "plan_modified",
      message: summary,
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
  const planWeeks = (input.plan_weeks || []) as Array<{
    week_number: number;
    start_date: string;
    detail_level: string;
    target_km: number;
    target_sessions: number;
    session_types?: string[];
  }>;
  const workouts = (input.workouts || []) as Array<{
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
  const summary = String(input.summary || `New plan: ${planName || "Training plan"}`);

  if (!Array.isArray(workouts) || workouts.length === 0) {
    return {
      success: false,
      error: "The workouts array is empty. Include workouts for detailed weeks (1-2) and outline weeks (3-4). Do NOT include workouts for target weeks (5+).",
    };
  }

  if (!Array.isArray(phases) || phases.length === 0) {
    return {
      success: false,
      error: "The phases array is empty. You must include at least one phase.",
    };
  }

  if (!Array.isArray(planWeeks) || planWeeks.length === 0) {
    return {
      success: false,
      error: "The plan_weeks array is empty. You must include metadata for every week of the plan with detail_level, target_km, and target_sessions.",
    };
  }

  // Apply plan directly (Brocco should have asked for verbal confirmation first)
  const payload = {
    plan_name: planName,
    goal,
    race_date: raceDate,
    start_date: startDate,
    phases,
    plan_weeks: planWeeks,
    workouts,
  };

  const result = await applyPlanGeneration(userId, payload);

  return {
    success: true,
    data: {
      planId: result.planId,
      summary,
      planName: result.planName,
      totalWorkouts: workouts.length,
      totalPhases: phases.length,
      totalWeeks: planWeeks.length,
    },
    notification: {
      type: "plan_created",
      message: `Plan created: ${result.planName}`,
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

// --- Life planner tools ---

import {
  parseWall,
  formatDateShort,
  formatTimeShort,
  getAgenda,
  renderAgendaText,
  todayInTimezone,
  wallDateString,
  addDaysWall,
} from "@/lib/schedule";
import { setTodoDone, resolveListByName, parseDueDate } from "@/lib/todos";
import { moodEmoji, moodLabel, renderJournalText, averageMood } from "@/lib/journal";
import type { EventCategory, RecurrenceFreq, TodoPriority } from "@prisma/client";

const EVENT_CATEGORIES = ["work", "family", "training", "social", "health", "birthday", "other"];
const RECURRENCE_FREQS = ["none", "daily", "weekly", "monthly", "yearly"];
const TODO_PRIORITIES = ["low", "medium", "high"];

/**
 * Strict wall-time parse for model-supplied dates. The model occasionally
 * emits things like "next Tuesday" — that must become a correctable tool
 * error, not an Invalid Date that explodes inside Prisma and 502s the
 * whole capture.
 */
function parseWallStrict(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(s)) return null;
  const d = parseWall(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseStartInput(start: string, allDayFlag?: boolean): { startAt: Date; allDay: boolean } | null {
  const startAt = parseWallStrict(start);
  if (!startAt) return null;
  const allDay = allDayFlag ?? start.length <= 10;
  return { startAt, allDay };
}

function eventToast(title: string, startAt: Date, allDay: boolean): string {
  const dateStr = startAt.toISOString().slice(0, 10);
  const time = allDay ? "" : ` ${formatTimeShort(startAt.toISOString().slice(0, 16))}`;
  return `${title} — ${formatDateShort(dateStr)}${time}`;
}

async function handleManageEvent(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = input.action as string;
  const rec = (input.recurrence || {}) as { freq?: string; interval?: number; until?: string; count?: number };
  const recurrenceFreq = (RECURRENCE_FREQS.includes(rec.freq || "") ? rec.freq : "none") as RecurrenceFreq;

  if (action === "create") {
    if (!input.title || !input.start) {
      return { success: false, error: "title and start are required to create an event" };
    }
    const parsed = parseStartInput(input.start as string, input.all_day as boolean | undefined);
    if (!parsed) {
      return { success: false, error: `Invalid start "${input.start}" — use 'yyyy-MM-ddTHH:mm' or 'yyyy-MM-dd', resolving relative dates yourself` };
    }
    const { startAt, allDay } = parsed;
    const endAt = input.end ? parseWallStrict(input.end) : null;
    if (input.end && !endAt) {
      return { success: false, error: `Invalid end "${input.end}" — use 'yyyy-MM-ddTHH:mm'` };
    }
    const event = await prisma.event.create({
      data: {
        userId,
        title: input.title as string,
        location: (input.location as string) || null,
        notes: (input.notes as string) || null,
        category: (EVENT_CATEGORIES.includes(input.category as string) ? input.category : "other") as EventCategory,
        startAt,
        endAt,
        allDay,
        recurrence: recurrenceFreq,
        recurrenceInterval: rec.interval && rec.interval > 0 ? rec.interval : 1,
        recurrenceUntil: rec.until ? parseWallStrict(rec.until) : null,
        recurrenceCount: rec.count || null,
        reminderMinutes: input.reminder_minutes != null ? Number(input.reminder_minutes) : null,
      },
    });
    return {
      success: true,
      data: { event_id: event.id, title: event.title, start: event.startAt.toISOString().slice(0, 16) },
      notification: {
        type: "event_created",
        message: eventToast(event.title, event.startAt, event.allDay),
        data: { id: event.id, domain: "calendar" },
      },
    };
  }

  if (action === "update") {
    const event = await prisma.event.findFirst({ where: { id: input.event_id as string, userId } });
    if (!event) return { success: false, error: "Event not found" };

    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.location !== undefined) data.location = input.location || null;
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.category !== undefined && EVENT_CATEGORIES.includes(input.category as string)) data.category = input.category;
    if (input.start !== undefined) {
      const parsed = parseStartInput(input.start as string, input.all_day as boolean | undefined);
      if (!parsed) {
        return { success: false, error: `Invalid start "${input.start}" — use 'yyyy-MM-ddTHH:mm' or 'yyyy-MM-dd'` };
      }
      data.startAt = parsed.startAt;
      if (input.all_day !== undefined || (input.start as string).length <= 10) data.allDay = parsed.allDay;
    } else if (input.all_day !== undefined) {
      data.allDay = !!input.all_day;
    }
    if (input.end !== undefined) {
      if (input.end) {
        const endAt = parseWallStrict(input.end);
        if (!endAt) return { success: false, error: `Invalid end "${input.end}" — use 'yyyy-MM-ddTHH:mm'` };
        data.endAt = endAt;
      } else {
        data.endAt = null;
      }
    }
    if (input.reminder_minutes !== undefined) data.reminderMinutes = input.reminder_minutes != null ? Number(input.reminder_minutes) : null;
    if (input.recurrence !== undefined) {
      data.recurrence = recurrenceFreq;
      data.recurrenceInterval = rec.interval && rec.interval > 0 ? rec.interval : 1;
      data.recurrenceUntil = rec.until ? parseWall(rec.until) : null;
      data.recurrenceCount = rec.count || null;
    }

    const updated = await prisma.event.update({ where: { id: event.id }, data });
    return {
      success: true,
      data: { event_id: updated.id, title: updated.title, start: updated.startAt.toISOString().slice(0, 16) },
      notification: {
        type: "event_updated",
        message: eventToast(updated.title, updated.startAt, updated.allDay),
        data: { id: updated.id, domain: "calendar" },
      },
    };
  }

  if (action === "delete") {
    const event = await prisma.event.findFirst({ where: { id: input.event_id as string, userId } });
    if (!event) return { success: false, error: "Event not found" };

    if (input.delete_scope === "occurrence" && event.recurrence !== "none") {
      if (!input.occurrence_date) {
        return { success: false, error: "occurrence_date required when delete_scope=occurrence" };
      }
      const exdates = Array.isArray(event.exdates) ? (event.exdates as string[]) : [];
      const dateStr = (input.occurrence_date as string).slice(0, 10);
      if (!exdates.includes(dateStr)) exdates.push(dateStr);
      await prisma.event.update({ where: { id: event.id }, data: { exdates } });
      return {
        success: true,
        data: { event_id: event.id, removed_occurrence: dateStr },
        notification: {
          type: "event_deleted",
          message: `${event.title} removed on ${formatDateShort(dateStr)}`,
          data: { id: event.id, domain: "calendar" },
        },
      };
    }

    await prisma.event.delete({ where: { id: event.id } });
    return {
      success: true,
      data: { event_id: event.id, deleted: true },
      notification: {
        type: "event_deleted",
        message: `${event.title} deleted`,
        data: { id: event.id, domain: "calendar" },
      },
    };
  }

  return { success: false, error: `Unknown manage_event action: ${action}` };
}

async function handleManageTask(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = input.action as string;
  const rec = (input.recurrence || {}) as { freq?: string; interval?: number };
  const recurrenceFreq = (RECURRENCE_FREQS.includes(rec.freq || "") ? rec.freq : "none") as RecurrenceFreq;

  if (action === "create") {
    if (!input.title) return { success: false, error: "title is required" };
    let listId: string | null = null;
    let listName: string | null = null;
    if (input.list) {
      const list = await resolveListByName(userId, input.list as string);
      listId = list.id;
      listName = list.name;
    }
    const dueDate = parseDueDate(input.due_date);

    // A hallucinated/foreign parent id must not link a subtask across users
    // (the other user deleting their task would cascade-delete this one).
    let parentId: string | null = null;
    if (input.parent_task_id) {
      const parent = await prisma.todo.findFirst({
        where: { id: input.parent_task_id as string, userId },
        select: { id: true },
      });
      if (!parent) return { success: false, error: "parent_task_id not found" };
      parentId = parent.id;
    }

    const task = await prisma.todo.create({
      data: {
        userId,
        listId,
        parentId,
        title: input.title as string,
        notes: (input.notes as string) || null,
        dueDate,
        dueTime: (input.due_time as string) || null,
        priority: (TODO_PRIORITIES.includes(input.priority as string) ? input.priority : null) as TodoPriority | null,
        recurrence: recurrenceFreq,
        recurrenceInterval: rec.interval && rec.interval > 0 ? rec.interval : 1,
        recurrenceAnchor: recurrenceFreq !== "none" ? dueDate : null,
      },
    });
    const subtaskTitles = (input.subtasks as string[]) || [];
    if (Array.isArray(subtaskTitles) && subtaskTitles.length > 0) {
      await prisma.todo.createMany({
        data: subtaskTitles.map((t, i) => ({ userId, parentId: task.id, listId, title: String(t), position: i })),
      });
    }
    const dueLabel = dueDate ? ` — ${formatDateShort(dueDate.toISOString().slice(0, 10))}${input.due_time ? ` ${input.due_time}` : ""}` : "";
    return {
      success: true,
      data: { task_id: task.id, title: task.title, list: listName || "Inbox", subtasks_created: subtaskTitles.length },
      notification: {
        type: "task_created",
        message: `${task.title}${dueLabel}${listName ? ` (${listName})` : ""}`,
        data: { id: task.id, domain: "tasks" },
      },
    };
  }

  if (action === "complete" || action === "reopen") {
    const result = await setTodoDone(userId, input.task_id as string, action === "complete");
    if (!result) return { success: false, error: "Task not found" };
    const nextInfo = result.nextOccurrence
      ? ` (next: ${formatDateShort(result.nextOccurrence.dueDate!.toISOString().slice(0, 10))})`
      : "";
    return {
      success: true,
      data: {
        task_id: result.todo.id,
        done: result.todo.done,
        next_occurrence_id: result.nextOccurrence?.id || null,
      },
      notification: {
        type: action === "complete" ? "task_completed" : "task_reopened",
        message: action === "complete" ? `Done: ${result.todo.title}${nextInfo}` : `Reopened: ${result.todo.title}`,
        data: { id: result.todo.id, domain: "tasks" },
      },
    };
  }

  if (action === "update") {
    const task = await prisma.todo.findFirst({ where: { id: input.task_id as string, userId } });
    if (!task) return { success: false, error: "Task not found" };
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.notes !== undefined) data.notes = input.notes || null;
    if (input.due_date !== undefined) data.dueDate = parseDueDate(input.due_date);
    if (input.due_time !== undefined) data.dueTime = input.due_time || null;
    if (input.priority !== undefined) data.priority = TODO_PRIORITIES.includes(input.priority as string) ? input.priority : null;
    if (input.list !== undefined) {
      if (input.list) {
        const list = await resolveListByName(userId, input.list as string);
        data.listId = list.id;
      } else {
        data.listId = null;
      }
    }
    if (input.recurrence !== undefined) {
      data.recurrence = recurrenceFreq;
      data.recurrenceInterval = rec.interval && rec.interval > 0 ? rec.interval : 1;
    }
    const updated = await prisma.todo.update({ where: { id: task.id }, data });
    return {
      success: true,
      data: { task_id: updated.id, title: updated.title },
      notification: {
        type: "task_updated",
        message: `Updated: ${updated.title}`,
        data: { id: updated.id, domain: "tasks" },
      },
    };
  }

  if (action === "delete") {
    const task = await prisma.todo.findFirst({ where: { id: input.task_id as string, userId } });
    if (!task) return { success: false, error: "Task not found" };
    await prisma.todo.delete({ where: { id: task.id } });
    return {
      success: true,
      data: { task_id: task.id, deleted: true },
      notification: { type: "task_deleted", message: `Deleted: ${task.title}`, data: { id: task.id, domain: "tasks" } },
    };
  }

  if (action === "create_list") {
    if (!input.title && !input.list) return { success: false, error: "Provide the list name in 'list'" };
    const list = await resolveListByName(userId, (input.list || input.title) as string);
    return {
      success: true,
      data: { list_id: list.id, name: list.name, already_existed: !list.created },
      notification: { type: "list_created", message: `List: ${list.name}`, data: { id: list.id, domain: "tasks" } },
    };
  }

  if (action === "rename_list") {
    const list = await prisma.taskList.findFirst({ where: { id: input.list_id as string, userId } });
    if (!list) return { success: false, error: "List not found" };
    const updated = await prisma.taskList.update({ where: { id: list.id }, data: { name: input.new_name as string } });
    return {
      success: true,
      data: { list_id: updated.id, name: updated.name },
      notification: { type: "list_updated", message: `List renamed: ${updated.name}`, data: { id: updated.id, domain: "tasks" } },
    };
  }

  if (action === "delete_list") {
    const list = await prisma.taskList.findFirst({ where: { id: input.list_id as string, userId } });
    if (!list) return { success: false, error: "List not found" };
    await prisma.taskList.delete({ where: { id: list.id } }); // todos fall back to Inbox via SetNull
    return {
      success: true,
      data: { list_id: list.id, deleted: true },
      notification: { type: "list_deleted", message: `List deleted: ${list.name} (tasks moved to Inbox)`, data: { id: list.id, domain: "tasks" } },
    };
  }

  return { success: false, error: `Unknown manage_task action: ${action}` };
}

async function handleManageNote(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = input.action as string;

  if (action === "create") {
    if (!input.title) return { success: false, error: "title is required" };
    const note = await prisma.note.create({
      data: {
        userId,
        title: input.title as string,
        body: (input.body as string) || "",
        tags: Array.isArray(input.tags) ? (input.tags as string[]).map(String) : [],
      },
    });
    return {
      success: true,
      data: { note_id: note.id, title: note.title },
      notification: { type: "note_saved", message: `Note saved: ${note.title}`, data: { id: note.id, domain: "notes" } },
    };
  }

  if (action === "update" || action === "append") {
    const note = await prisma.note.findFirst({ where: { id: input.note_id as string, userId } });
    if (!note) return { success: false, error: "Note not found" };
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) {
      data.body = action === "append" ? `${note.body}\n${input.body}`.trim() : input.body;
    }
    if (input.tags !== undefined) data.tags = Array.isArray(input.tags) ? (input.tags as string[]).map(String) : [];
    const updated = await prisma.note.update({ where: { id: note.id }, data });
    return {
      success: true,
      data: { note_id: updated.id, title: updated.title },
      notification: { type: "note_saved", message: `Note updated: ${updated.title}`, data: { id: updated.id, domain: "notes" } },
    };
  }

  if (action === "search") {
    const query = (input.query as string) || "";
    const notes = await prisma.note.findMany({
      where: {
        userId,
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { body: { contains: query, mode: "insensitive" } },
                { tags: { has: query.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, body: true, tags: true, updatedAt: true },
    });
    return {
      success: true,
      data: {
        notes: notes.map((n) => ({
          note_id: n.id,
          title: n.title,
          body: n.body.length > 500 ? n.body.slice(0, 500) + "…" : n.body,
          tags: n.tags,
        })),
      },
    };
  }

  if (action === "delete") {
    const note = await prisma.note.findFirst({ where: { id: input.note_id as string, userId } });
    if (!note) return { success: false, error: "Note not found" };
    await prisma.note.delete({ where: { id: note.id } });
    return {
      success: true,
      data: { note_id: note.id, deleted: true },
      notification: { type: "note_deleted", message: `Note deleted: ${note.title}`, data: { id: note.id, domain: "notes" } },
    };
  }

  return { success: false, error: `Unknown manage_note action: ${action}` };
}

async function handleQuerySchedule(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const from = (input.date_from as string)?.slice(0, 10);
  const to = (input.date_to as string)?.slice(0, 10);
  if (!from || !to) return { success: false, error: "date_from and date_to are required" };

  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
  const today = todayInTimezone(profile?.timezone || "Europe/Berlin");

  const agenda = await getAgenda(userId, from, to, {
    includeOverdueTodos: input.include_overdue_tasks !== false,
    today,
    includeRestWorkouts: false,
  });

  return {
    success: true,
    data: { schedule: renderAgendaText(agenda), today },
  };
}

// --- log_journal ---

async function handleLogJournal(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = input.action as string;

  if (action === "log") {
    const mood = input.mood == null ? null : Number(input.mood);
    const text = input.text != null ? String(input.text).trim() : null;
    if (mood == null && !text) {
      return { success: false, error: "mood or text is required" };
    }
    if (mood != null && (!Number.isInteger(mood) || mood < 1 || mood > 5)) {
      return { success: false, error: "mood must be an integer 1-5" };
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
    const day = todayInTimezone(profile?.timezone || "Europe/Berlin");
    const tags = Array.isArray(input.tags)
      ? (input.tags as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 10)
      : [];

    const entry = await prisma.journalEntry.create({
      data: { userId, day, mood, tags, text: text || null },
    });

    const message = mood
      ? `Mood logged: ${moodEmoji(mood)} ${moodLabel(mood)}`
      : "Journal entry saved";
    return {
      success: true,
      data: { entry_id: entry.id, day, mood, has_text: !!text },
      notification: { type: "journal_saved", message, data: { id: entry.id, domain: "journal" } },
    };
  }

  if (action === "recent") {
    const days = Math.min(Math.max(Number(input.days) || 14, 1), 90);
    const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { timezone: true } });
    const today = todayInTimezone(profile?.timezone || "Europe/Berlin");
    const fromDay = wallDateString(addDaysWall(parseWall(today), -days));

    const entries = await prisma.journalEntry.findMany({
      where: { userId, day: { gte: fromDay } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { day: true, mood: true, tags: true, text: true },
    });

    return {
      success: true,
      data: {
        journal: renderJournalText(entries),
        average_mood: averageMood(entries),
        entry_count: entries.length,
      },
    };
  }

  return { success: false, error: `Unknown log_journal action: ${action}` };
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
