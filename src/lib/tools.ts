import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, format, subDays } from "date-fns";
import type Anthropic from "@anthropic-ai/sdk";
import {
  applyPlanGeneration,
  applyPlanModifications,
  weekNumberForDate as weekNumberForPlanDate,
} from "@/lib/apply-plan";
import { normalizeUpdates } from "@/lib/apply-plan";
import { normalizeEquipment } from "@/lib/equipment";
import { syncWorkoutsInBackground } from "@/lib/intervals-icu";
import {
  reconcileWeek,
  currentWeekStart,
  weekStartOf,
  resolveCredit,
} from "@/lib/weekly-goals";

// --- Tool definitions for the Anthropic API ---

// Structured interval steps for on-watch guidance (synced to the user's
// watch via intervals.icu). One nesting level: steps, or a repeat block.
const STEPS_SCHEMA = {
  type: "array" as const,
  description:
    "Structured steps for interval/tempo/race_pace workouts so the watch can guide each rep (warmup / Nx(work, recovery) / cooldown). Each step: {kind: warmup|steady|work|recovery|cooldown, distance_km OR duration_min, pace (e.g. '4:25-4:35/km'), label?}. Repeats: {kind: 'repeat', times, steps: [work, recovery]}. Omit for plain easy/long runs — their distance+pace targets are enough.",
  items: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["warmup", "steady", "work", "recovery", "cooldown", "repeat"] },
      distance_km: { type: "number" },
      duration_min: { type: "number" },
      pace: { type: "string", description: "e.g. '4:25-4:35/km' or '6:30/km'" },
      label: { type: "string", description: "Short cue, e.g. 'stride' or '800m rep'" },
      times: { type: "integer", description: "For kind=repeat" },
      steps: {
        type: "array",
        description: "For kind=repeat — the steps to repeat",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["work", "recovery", "steady"] },
            distance_km: { type: "number" },
            duration_min: { type: "number" },
            pace: { type: "string" },
            label: { type: "string" },
          },
          required: ["kind"],
        },
      },
    },
    required: ["kind"],
  },
};

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
          enum: ["run", "cycle", "swim", "strength", "yoga", "hike", "climb", "other"],
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
      "Retrieve specific historical training data not in the default context window. query_type 'plan_outline' returns the ACTIVE plan's full structure — goal, race date, every phase, and every week's start date, detail level, target km, target sessions and session codes — use it before converting or restructuring an existing plan.",
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
            "plan_outline",
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
      "Make reactive micro-adjustments to workouts within the current week. Auto-applied immediately, no user confirmation needed. Use for: changing the distance, pace or duration of a session this week, MOVING a session to a different day this week (pass `date` in updates — you can move it and retarget it in the same adjustment), reducing intensity after fatigue signals, marking a workout as covered. Do NOT use for: adding/deleting workouts, changing workout types, anything beyond 7 days out, changing weekly mileage targets or phase boundaries.",
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
                  "Fields to change. Use exactly these names. Not used by mark_covered.",
                properties: {
                  distance: { type: "number", description: "Target distance in KILOMETRES" },
                  pace: { type: "string", description: "Target pace, e.g. '6:15-6:45/km'" },
                  duration: { type: "number", description: "Target duration in MINUTES" },
                  date: {
                    type: "string",
                    description:
                      "ISO date (YYYY-MM-DD) to move this workout to. Works with update_targets — you can move a session and change its targets in ONE adjustment.",
                  },
                  swap_with_workout_id: {
                    type: "string",
                    description: "swap_rest_day only: the workout to trade dates with.",
                  },
                },
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
      "Propose structural changes to the training plan. Requires user confirmation. Use for: adding/deleting workouts, changing workout types, moving workouts across weeks, modifying weekly mileage targets or phase boundaries, any change beyond 7 days out. ONE WORKOUT = ONE SPORT, ONE SESSION: when adding a brick or double day, add it as separate single-sport workouts on the same date (each its own activity_type/title/targets), never one combined entry — combined workouts don't sync to the watch.",
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
                description:
                  "Fields to change (update) or the new workout's fields (add). Use exactly these names.",
                properties: {
                  title: { type: "string" },
                  workout_type: { type: "string", description: "easy, long, tempo, interval, recovery, race_pace, cross_training, strength, rest, race, climbing" },
                  activity_type: { type: "string", description: "run, cycle, swim, climb, other — REQUIRED for non-running sessions" },
                  distance: { type: "number", description: "KILOMETRES" },
                  pace: { type: "string" },
                  duration: { type: "number", description: "MINUTES" },
                  date: { type: "string", description: "update only: ISO date to move the workout to" },
                  description: { type: "string" },
                  steps: STEPS_SCHEMA,
                },
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
        training_equipment: {
          type: "array",
          items: { type: "string" },
          description:
            "Kit the athlete owns, e.g. ['resistance bands', '16kg kettlebell', 'balance board']. REPLACES the stored list, so send the full list, not just the new item — read the current one from EQUIPMENT THE ATHLETE HAS in your context first.",
        },
        goal_race_date: {
          type: "string",
          description: "ISO date",
        },
        goal_time: { type: "string" },
        primary_sport: {
          type: "string",
          description:
            "The athlete's MAIN sport, lowercase singular noun: 'climbing', 'cycling', 'triathlon'. Save it as soon as they make clear their main sport isn't running — it reshapes your persona and their plans. Omit / never set for runners (running is the default).",
        },
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
      "Generate a training plan using the rolling horizon approach. Creates phases for the full plan, plan_weeks metadata for every week, and individual workouts ONLY for weeks with detail_level 'detailed' (weeks 1-2) and 'outline' (weeks 3-4). Do NOT generate workouts for 'target' weeks (week 5+). This dramatically reduces output size. WEEKS ARE MONDAY–SUNDAY: every plan_week start_date is a Monday. If the plan starts mid-week, add a partial lead-in week_number 0 (start_date = the actual start day, running to that Sunday) and begin week_number 1 the following Monday; if it starts on a Monday, begin at week 1 with no week 0.",
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
              target_km: { type: "number", description: "Target running km for the week. For non-distance sports (e.g. a climbing plan) set 0 — the app then tracks the week by sessions instead of km." },
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
          description: "Individual workouts ONLY for 'detailed' weeks (1-2, full specs) and 'outline' weeks (3-4, type + approximate distance only). Do NOT include workouts for 'target' weeks. ONE WORKOUT = ONE SPORT, ONE SESSION: never combine sports or sessions in a single entry. A brick or double day (e.g. run + ride, or AM/PM sessions) is TWO entries on the same date, each with its own activity_type, title, and targets — this is required for the workout to sync to the user's watch.",
          items: {
            type: "object",
            properties: {
              date: { type: "string", description: "ISO date" },
              week_number: { type: "integer" },
              title: { type: "string", description: "e.g., 'Easy Run'" },
              workout_type: {
                type: "string",
                enum: ["easy", "long", "tempo", "interval", "race_pace", "recovery", "rest", "cross_training", "strength", "race", "climbing"],
              },
              detail_level: {
                type: "string",
                enum: ["detailed", "outline"],
                description: "detailed = full specs (pace, description). outline = type + approx distance only.",
              },
              activity_type: {
                type: "string",
                enum: ["run", "cycle", "swim", "hike", "strength", "climb", "rest", "other"],
                description: "The single sport for this workout (defaults to 'run'). Each workout is exactly one sport — split combined sessions into separate workouts.",
              },
              target_distance_km: { type: "number", description: "REQUIRED for every run (activity_type 'run'), including plain easy runs — km is how running volume is measured. Omit for cycling (use target_duration_min instead)." },
              target_pace: { type: "string", description: "For detailed workouts only, e.g., '4:15-4:30/km'" },
              target_duration_min: { type: "integer", description: "REQUIRED for cycling and other non-run sports (measured in minutes, no km). Optional extra for runs." },
              description: { type: "string", description: "For detailed workouts only" },
              steps: STEPS_SCHEMA,
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
    name: "manage_weekly_goals",
    description:
      "Flexible weekly training goals — 'do this N times this week' with no fixed days. Use for strength, mobility, rehab and any work where WHEN it happens doesn't matter, only HOW OFTEN. Progress is counted automatically from the athlete's activities (Strava, manual logs, in-app workouts), so never ask them to tick anything off. Goals belong to the athlete, not to a training plan, and reset each week. Use action 'set' to create or update one, 'list' to read current progress before commenting on it, 'remove' to drop one, and 'resolve' when a session could have counted towards more than one goal and you need to say which (or that it counts for none).",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["set", "list", "remove", "resolve"] },
        label: {
          type: "string",
          description: "For set/remove: what the athlete calls it, e.g. 'Ankle strength'. Reused as the identity of the goal within a week.",
        },
        category: {
          type: "string",
          enum: ["strength", "mobility", "nutrition", "recovery", "other"],
          description: "For set. Determines which activities can count: strength counts WeightTraining/Crossfit/Workout, mobility counts Yoga/Pilates/Workout, recovery counts Yoga/Walk/Hike. nutrition and other are tracked but never auto-counted.",
        },
        target_count: { type: "integer", description: "For set: how many sessions this week." },
        week_start: {
          type: "string",
          description: "Optional ISO date (Monday). Defaults to the current week — use that unless the athlete is explicitly planning ahead.",
        },
        activity_id: { type: "string", description: "For resolve: the session in question." },
        goal_id: {
          type: "string",
          description: "For resolve: the goal it should count towards. Omit to count it towards none.",
        },
      },
      required: ["action"],
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
    name: "create_workout",
    description:
      'Create a guided S&C (strength & conditioning) session the user can play in the workout timer (big countdown, voice cues). Use when the user asks for a workout to DO now or to save for later ("make me a 20-minute core workout", "something for my hips, no equipment"). Design for runners: bodyweight by default, 10-30 min, left/right sides as separate entries, short form cues in notes. Prefer mode "time" (30-45s work) for flow; "reps" only where counting matters. Respect active injuries from the health context. After creating, tell the user it\'s ready in the Workouts screen.',
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "e.g. 'Core Stability 15'" },
        focus: { type: "string", description: "e.g. 'core', 'hips & glutes', 'full body'" },
        definition: {
          type: "object",
          description:
            "The workout structure. Shape: {warmupSec?, cooldownSec?, blocks: [{label?, rounds (1-10), restBetweenRoundsSec?, exercises: [{name, mode: 'time'|'reps', workSec? (5-600, for time), reps? (1-100, for reps), restSec? (0-600), note?}]}]} — 1-3 blocks, 3-8 exercises each.",
          properties: {
            warmupSec: { type: "integer" },
            cooldownSec: { type: "integer" },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  rounds: { type: "integer" },
                  restBetweenRoundsSec: { type: "integer" },
                  exercises: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        mode: { type: "string", enum: ["time", "reps"] },
                        workSec: { type: "integer" },
                        reps: { type: "integer" },
                        restSec: { type: "integer" },
                        note: { type: "string" },
                      },
                      required: ["name", "mode"],
                    },
                  },
                },
                required: ["rounds", "exercises"],
              },
            },
          },
          required: ["blocks"],
        },
      },
      required: ["title", "definition"],
    },
  },
  {
    name: "manage_recipe",
    description:
      "The user's recipe library (kitchen helper). Actions: 'search' recipes by ingredient/title/tag (ALWAYS search before suggesting meals — prefer their own saved recipes), 'get' full ingredients+steps by id, 'save' a new recipe (when the user asks to keep one you suggested, or dictates one), 'cooked' to log that they made it, 'delete'. Pantry staples (ingredients always in stock, e.g. curry paste, chickpeas — assume them available in EVERY suggestion): 'staples_add' / 'staples_remove' with the staples array, 'staples_list' to read. When the user lists ingredients they have (\"I have zucchini, eggs, feta\"), search the library for matches first, then suggest — combining their listed ingredients WITH their pantry staples — and consider their training: carb-forward before long runs, protein after strength sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", enum: ["search", "get", "save", "cooked", "delete", "staples_add", "staples_remove", "staples_list"] },
        recipe_id: { type: "string", description: "For get/cooked/delete" },
        query: { type: "string", description: "For search — ingredient, title, or tag" },
        staples: { type: "array", items: { type: "string" }, description: "For staples_add/staples_remove — ingredient names" },
        title: { type: "string" },
        ingredients: { type: "array", items: { type: "string" }, description: "One entry per ingredient, with quantity" },
        steps: { type: "array", items: { type: "string" } },
        tags: { type: "array", items: { type: "string" } },
        servings: { type: "integer" },
        time_min: { type: "integer" },
        notes: { type: "string" },
      },
      required: ["action"],
    },
  },
];

// --- Feature-gated tool selection ---

import type { Features } from "@/lib/features";

const TOOL_FEATURE_GATES: Record<string, (f: Features) => boolean> = {
  manage_event: (f) => f.calendar,
  query_schedule: (f) => f.calendar,
  manage_recipe: (f) => f.kitchen,
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
    case "manage_weekly_goals":
      return handleManageWeeklyGoals(input, userId);
    case "add_weekly_tasks":
      return handleAddWeeklyTasks(input, userId);
    case "manage_event":
      return handleManageEvent(input, userId);
    case "query_schedule":
      return handleQuerySchedule(input, userId);
    case "create_workout":
      return handleCreateWorkout(input, userId);
    case "manage_recipe":
      return handleManageRecipe(input, userId);
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
    climb: "RockClimbing",
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
    case "plan_outline": {
      // The chat context only carries this week + next; a plan conversion or
      // restructure needs the WHOLE arc — this returns it compactly.
      const plan = await prisma.plan.findFirst({
        where: { userId, status: "active" },
        include: {
          phases: { orderBy: { orderIndex: "asc" } },
          weeks: { orderBy: { weekNumber: "asc" }, include: { phase: { select: { name: true } } } },
        },
      });
      if (!plan) {
        return { success: false, error: "No active plan." };
      }
      return {
        success: true,
        data: {
          plan_name: plan.name,
          goal: plan.goal,
          race_date: plan.raceDate ? format(new Date(plan.raceDate), "yyyy-MM-dd") : null,
          start_date: format(new Date(plan.startDate), "yyyy-MM-dd"),
          end_date: format(new Date(plan.endDate), "yyyy-MM-dd"),
          phases: plan.phases.map((p) => ({
            name: p.name,
            description: p.description,
            start_week: p.startWeek,
            end_week: p.endWeek,
          })),
          weeks: plan.weeks.map((w) => ({
            week_number: w.weekNumber,
            start_date: format(new Date(w.startDate), "yyyy-MM-dd"),
            detail_level: w.detailLevel,
            target_km: w.targetKm != null ? Number(w.targetKm) : null,
            target_sessions: w.targetSessions,
            session_types: w.sessionTypes,
            phase: w.phase?.name || null,
            notes: w.notes,
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

  const results: Array<{
    workoutId: string;
    action: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const adj of adjustments) {
    const workout = await prisma.plannedWorkout.findFirst({
      where: { id: adj.workout_id, plan: { userId, status: "active" } },
    });

    if (!workout) {
      results.push({
        workoutId: adj.workout_id,
        action: adj.action,
        success: false,
        error:
          "No workout with that id on the active plan. The workout_id is wrong or stale — re-read the plan context and use an id listed there.",
      });
      continue;
    }

    const beforeState = {
      date: wallDateString(workout.date),
      targetDistanceKm: workout.targetDistanceKm ? Number(workout.targetDistanceKm) : null,
      targetPace: workout.targetPace,
      targetDurationMin: workout.targetDurationMin,
      status: workout.status,
    };

    // swap_rest_day moves a workout to another date (optionally trading dates
    // with a second workout). It touches two rows, so it can't go through the
    // single-row updateData path below.
    if (adj.action === "swap_rest_day") {
      const swap = await applyRestDaySwap(userId, workout, adj.updates);
      if (!swap.success) {
        results.push({
          workoutId: adj.workout_id,
          action: adj.action,
          success: false,
          error: swap.error,
        });
        continue;
      }
      await prisma.planAdjustmentLog.create({
        data: {
          userId,
          workoutId: adj.workout_id,
          action: "swap_rest_day",
          beforeState,
          afterState: { ...beforeState, date: swap.newDate },
          reason: adj.reason || summary,
          summary,
        },
      });
      // A swap mutates two rows; log the partner's move as well or the audit
      // trail claims only half the change happened.
      if (swap.partnerId) {
        await prisma.planAdjustmentLog.create({
          data: {
            userId,
            workoutId: swap.partnerId,
            action: "swap_rest_day",
            beforeState: { date: swap.newDate },
            afterState: { date: beforeState.date },
            reason: adj.reason || summary,
            summary,
          },
        });
      }
      results.push({ workoutId: adj.workout_id, action: adj.action, success: true });
      continue;
    }

    const updateData: Record<string, unknown> = {};
    if (adj.action === "update_targets" && adj.updates) {
      // Accepts the aliases the model actually emits (distance_km,
      // target_distance_km, target_pace, duration_min…). Anything with no
      // meaning here is rejected rather than dropped, since dropping applies
      // part of the change and reports all of it as done.
      const { values: u, unknown } = normalizeUpdates(adj.updates, [
        "distance",
        "pace",
        "duration",
        "date",
      ]);
      if (unknown.length > 0) {
        results.push({
          workoutId: adj.workout_id,
          action: adj.action,
          success: false,
          error:
            `update_targets does not support ${unknown.map((k) => `\`${k}\``).join(", ")} — it changes distance, pace, duration and date. ` +
            `Nothing was changed. For anything structural (adding, deleting or changing a workout's type) use modify_plan.`,
        });
        continue;
      }

      if (u.distance !== undefined) updateData.targetDistanceKm = Number(u.distance);
      if (u.pace !== undefined) updateData.targetPace = String(u.pace);
      if (u.duration !== undefined) updateData.targetDurationMin = Number(u.duration);

      // Moving a session within the week is the single most common request
      // ("do Saturday's run today instead"), and the model kept sending `date`
      // here regardless of what the schema said. Handle it rather than reject.
      if (u.date !== undefined) {
        const newDate = new Date(String(u.date));
        if (Number.isNaN(newDate.getTime())) {
          results.push({
            workoutId: adj.workout_id,
            action: adj.action,
            success: false,
            error: `"${String(u.date)}" is not a valid ISO date. Nothing was changed.`,
          });
          continue;
        }
        const week = await weekNumberForPlanDate(workout.planId, newDate);
        if (week.kind === "outside") {
          results.push({
            workoutId: adj.workout_id,
            action: adj.action,
            success: false,
            error: `${String(u.date)} falls outside every week of this plan, so the workout would not show up anywhere. Nothing was changed.`,
          });
          continue;
        }
        updateData.date = newDate;
        if (week.kind === "resolved") updateData.weekNumber = week.weekNumber;
      }

      if (Object.keys(updateData).length > 0) updateData.status = "modified";
    } else if (adj.action === "mark_covered") {
      updateData.status = "completed";
    }

    // Nothing to write means nothing changed — never report that as applied.
    if (Object.keys(updateData).length === 0) {
      results.push({
        workoutId: adj.workout_id,
        action: adj.action,
        success: false,
        error:
          adj.action === "update_targets"
            ? "update_targets needs at least one of distance, pace or duration in `updates`."
            : `Unsupported action "${adj.action}".`,
      });
      continue;
    }

    await prisma.plannedWorkout.update({
      where: { id: adj.workout_id },
      data: updateData,
    });

    await prisma.planAdjustmentLog.create({
      data: {
        userId,
        workoutId: adj.workout_id,
        action: adj.action as "update_targets" | "swap_rest_day" | "mark_covered",
        beforeState,
        afterState: { ...beforeState, ...updateData },
        reason: adj.reason || summary,
        summary,
      },
    });

    results.push({ workoutId: adj.workout_id, action: adj.action, success: true });
  }

  const failed = results.filter((r) => !r.success);
  const appliedCount = results.length - failed.length;

  // Nothing landed in the database — report a failure so the coach tells the
  // user instead of announcing a change that never happened.
  if (appliedCount === 0) {
    return {
      success: false,
      error: `No adjustments were applied. ${failed
        .map((f) => `${f.action} on ${f.workoutId}: ${f.error}`)
        .join(" | ")}`,
      data: { adjustments: results },
    };
  }

  syncWorkoutsInBackground(userId); // push adjusted targets to the watch calendar

  return {
    success: true,
    data: { adjustments: results, appliedCount, failedCount: failed.length },
    notification: {
      type: failed.length > 0 ? "plan_adjusted_partial" : "plan_adjusted",
      message:
        failed.length > 0
          ? `Partly applied — ${failed.length} of ${results.length} change(s) failed: ${failed
              .map((f) => f.error)
              .join(" ")}`
          : summary,
      data: { results },
    },
  };
}

/**
 * Moves a workout to a different date, optionally trading dates with another
 * workout (the "swap" in swap_rest_day). Both rows are scoped through the
 * plan's userId, and the two dates are written in one transaction so a swap
 * can never leave both workouts on the same day.
 */
async function applyRestDaySwap(
  userId: string,
  workout: { id: string; date: Date; planId: string; weekNumber: number },
  updates: Record<string, unknown> | undefined
): Promise<
  | { success: true; newDate: string; partnerId?: string }
  | { success: false; error: string }
> {
  const partnerId = updates?.swap_with_workout_id as string | undefined;

  if (partnerId) {
    const partner = await prisma.plannedWorkout.findFirst({
      where: { id: partnerId, plan: { userId, status: "active" } },
    });
    if (!partner) {
      return {
        success: false,
        error: `swap_with_workout_id "${partnerId}" is not a workout on the active plan.`,
      };
    }
    // Each row takes the other's weekNumber along with its date — the Plan tab
    // groups strictly by weekNumber, so a swap across a week boundary would
    // otherwise leave a workout displayed under a week it no longer falls in.
    await prisma.$transaction([
      prisma.plannedWorkout.update({
        where: { id: workout.id },
        data: { date: partner.date, weekNumber: partner.weekNumber, status: "modified" },
      }),
      prisma.plannedWorkout.update({
        where: { id: partner.id },
        data: { date: workout.date, weekNumber: workout.weekNumber, status: "modified" },
      }),
    ]);
    return { success: true, newDate: wallDateString(partner.date), partnerId: partner.id };
  }

  const dateStr = updates?.date as string | undefined;
  if (!dateStr) {
    return {
      success: false,
      error: "swap_rest_day needs `updates.date` (the ISO date to move the workout to) or `updates.swap_with_workout_id`.",
    };
  }
  const newDate = new Date(dateStr);
  if (Number.isNaN(newDate.getTime())) {
    return { success: false, error: `"${dateStr}" is not a valid ISO date.` };
  }

  const week = await weekNumberForPlanDate(workout.planId, newDate);
  if (week.kind === "outside") {
    return {
      success: false,
      error: `${dateStr} falls outside every week of this plan, so the workout would not show up anywhere. Nothing was changed.`,
    };
  }

  await prisma.plannedWorkout.update({
    where: { id: workout.id },
    data: {
      date: newDate,
      status: "modified",
      ...(week.kind === "resolved" ? { weekNumber: week.weekNumber } : {}),
    },
  });
  return { success: true, newDate: wallDateString(newDate) };
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

  const failed = results.filter((r) => !r.success);
  const appliedCount = results.length - failed.length;

  // Nothing landed in the database — report a failure so the coach tells the
  // user instead of announcing a change that never happened.
  if (appliedCount === 0) {
    return {
      success: false,
      error: `No plan changes were applied. ${failed
        .map((f) => `${f.action}${f.workoutId ? ` on ${f.workoutId}` : ""}: ${f.error}`)
        .join(" | ")}`,
      data: { modifications: results },
    };
  }

  syncWorkoutsInBackground(userId); // reflect structural changes on the watch calendar

  return {
    success: true,
    data: { modifications: results, summary, appliedCount, failedCount: failed.length },
    notification: {
      type: failed.length > 0 ? "plan_modified_partial" : "plan_modified",
      message:
        failed.length > 0
          ? `Partly applied — ${failed.length} of ${results.length} change(s) failed: ${failed
              .map((f) => f.error)
              .join(" ")}`
          : summary,
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
    steps?: unknown;
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

  syncWorkoutsInBackground(userId); // push the fresh plan's first weeks to the watch calendar

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
import { validateWorkoutDefinition, estimateDurationMin } from "@/lib/guided-workout";
import { validateRecipeInput, recipeMatches, normalizeStaples } from "@/lib/recipes";
import type { EventCategory, RecurrenceFreq } from "@prisma/client";

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


// --- create_workout ---

async function handleCreateWorkout(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const title = String(input.title || "").trim();
  if (!title || title.length > 80) return { success: false, error: "title is required (max 80 chars)" };

  const validated = validateWorkoutDefinition(input.definition);
  if (!validated.ok) return { success: false, error: `Invalid definition: ${validated.error}` };

  const durationMin = estimateDurationMin(validated.def);
  const workout = await prisma.guidedWorkout.create({
    data: {
      userId,
      title,
      focus: input.focus ? String(input.focus).slice(0, 60) : null,
      durationMin,
      definition: validated.def as object,
      source: "brocco",
    },
  });

  return {
    success: true,
    data: { workout_id: workout.id, title, duration_min: durationMin, start_url: `/workout?start=${workout.id}` },
    notification: {
      type: "workout_created",
      message: `Workout ready: ${title} (~${durationMin} min)`,
      data: { id: workout.id, domain: "workout" },
    },
  };
}

// --- manage_recipe ---

async function handleManageRecipe(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = input.action as string;

  if (action === "search") {
    const query = String(input.query || "").trim().toLowerCase();
    // In-JS filtering: Prisma JSON filters can't substring-match inside a
    // JSONB string array, and personal libraries are small.
    const all = await prisma.recipe.findMany({
      where: { userId },
      orderBy: [{ timesCooked: "desc" }, { updatedAt: "desc" }],
      take: 300,
      select: { id: true, title: true, tags: true, servings: true, timeMin: true, timesCooked: true, ingredients: true },
    });
    const recipes = (query ? all.filter((r) => recipeMatches(r, query)) : all).slice(0, 10);
    return {
      success: true,
      data: {
        recipes: recipes.map((r) => ({
          recipe_id: r.id,
          title: r.title,
          tags: r.tags,
          servings: r.servings,
          time_min: r.timeMin,
          times_cooked: r.timesCooked,
          ingredients: ((r.ingredients as string[]) || []).slice(0, 12),
        })),
        count: recipes.length,
        hint: recipes.length === 0 ? "No matches in the library — suggest something from general knowledge instead." : "Use action 'get' for full steps.",
      },
    };
  }

  if (action === "get") {
    const recipe = await prisma.recipe.findFirst({ where: { id: input.recipe_id as string, userId } });
    if (!recipe) return { success: false, error: "Recipe not found" };
    return {
      success: true,
      data: {
        recipe_id: recipe.id,
        title: recipe.title,
        servings: recipe.servings,
        time_min: recipe.timeMin,
        tags: recipe.tags,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        notes: recipe.notes,
      },
    };
  }

  if (action === "save") {
    const validated = validateRecipeInput({
      title: input.title,
      ingredients: input.ingredients,
      steps: input.steps,
      tags: input.tags,
      servings: input.servings,
      timeMin: input.time_min,
      notes: input.notes,
    });
    if (!validated.ok) return { success: false, error: validated.error };
    const recipe = await prisma.recipe.create({
      data: {
        userId,
        title: validated.recipe.title,
        ingredients: validated.recipe.ingredients,
        steps: validated.recipe.steps,
        tags: validated.recipe.tags,
        servings: validated.recipe.servings,
        timeMin: validated.recipe.timeMin,
        notes: validated.recipe.notes,
        source: "chat",
      },
    });
    return {
      success: true,
      data: { recipe_id: recipe.id, title: recipe.title },
      notification: { type: "recipe_saved", message: `Recipe saved: ${recipe.title}`, data: { id: recipe.id, domain: "kitchen" } },
    };
  }

  if (action === "cooked") {
    const recipe = await prisma.recipe.findFirst({ where: { id: input.recipe_id as string, userId } });
    if (!recipe) return { success: false, error: "Recipe not found" };
    await prisma.recipe.update({ where: { id: recipe.id }, data: { timesCooked: { increment: 1 } } });
    return {
      success: true,
      data: { recipe_id: recipe.id, times_cooked: recipe.timesCooked + 1 },
      notification: { type: "recipe_cooked", message: `Enjoy! Logged: ${recipe.title}`, data: { id: recipe.id, domain: "kitchen" } },
    };
  }

  if (action === "delete") {
    const recipe = await prisma.recipe.findFirst({ where: { id: input.recipe_id as string, userId } });
    if (!recipe) return { success: false, error: "Recipe not found" };
    await prisma.recipe.delete({ where: { id: recipe.id } });
    return {
      success: true,
      data: { recipe_id: recipe.id, deleted: true },
      notification: { type: "recipe_deleted", message: `Recipe deleted: ${recipe.title}`, data: { id: recipe.id, domain: "kitchen" } },
    };
  }

  if (action === "staples_add" || action === "staples_remove" || action === "staples_list") {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { pantryStaples: true },
    });
    let staples = normalizeStaples(profile?.pantryStaples);

    if (action !== "staples_list") {
      const changes = normalizeStaples(input.staples);
      if (changes.length === 0) {
        return { success: false, error: "staples array required (ingredient names)" };
      }
      if (action === "staples_add") {
        staples = normalizeStaples([...staples, ...changes]);
      } else {
        const remove = new Set(changes.map((s) => s.toLowerCase()));
        staples = staples.filter((s) => !remove.has(s.toLowerCase()));
      }
      await prisma.userProfile.update({
        where: { userId },
        data: { pantryStaples: staples },
      });
      return {
        success: true,
        data: { staples },
        notification: {
          type: "staples_updated",
          message:
            action === "staples_add"
              ? `Pantry staples added: ${changes.join(", ")}`
              : `Pantry staples removed: ${changes.join(", ")}`,
          data: { domain: "kitchen" },
        },
      };
    }

    return { success: true, data: { staples } };
  }

  return { success: false, error: `Unknown manage_recipe action: ${action}` };
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
  if (input.primary_sport !== undefined) {
    const sport = String(input.primary_sport).trim().toLowerCase();
    // "running" is the default persona — store null so runners stay on the
    // unchanged classic prompt.
    updateData.primarySport = sport && sport !== "running" ? sport : null;
    savedFields.push("primary_sport");
  }
  if (input.training_equipment !== undefined) {
    // Replaces rather than appends — the tool description says so, and the
    // normaliser drops blanks and case-insensitive duplicates either way.
    const equipment = normalizeEquipment(input.training_equipment);
    updateData.trainingEquipment = equipment;
    savedFields.push(`equipment (${equipment.length})`);
  }

  // Deep-merge coaching_notes_update into existing coaching_notes
  if (input.coaching_notes_update && typeof input.coaching_notes_update === "object") {
    const existing = (profile.coachingNotes as Record<string, unknown>) || {};
    updateData.coachingNotes = deepMerge(existing, input.coaching_notes_update as Record<string, unknown>);
    savedFields.push("coaching_notes");
  }

  // No recognised field means nothing is written. Returning success here
  // produced a "Profile updated: " badge over an unchanged profile — the same
  // false success the plan tools had.
  if (Object.keys(updateData).length === 0) {
    return {
      success: false,
      error:
        "Nothing was saved — none of the supplied keys are fields save_profile can write. " +
        "Supported: name, years_running, weekly_km_baseline, goal_race, goal_race_date, goal_time, primary_sport, hr_max_bpm, coaching_notes_update. " +
        "Anything else belongs in coaching_notes_update.",
    };
  }

  await prisma.userProfile.update({
    where: { userId },
    data: updateData,
  });

  return {
    success: true,
    data: { saved_fields: savedFields },
    notification: {
      type: "profile_updated",
      message: `Profile updated: ${savedFields.join(", ")}`,
    },
  };
}

// --- manage_weekly_goals ---

async function handleManageWeeklyGoals(
  input: Record<string, unknown>,
  userId: string
): Promise<ToolResult> {
  const action = String(input.action || "");
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  const tz = profile?.timezone || "Europe/Berlin";
  const weekStart = input.week_start
    ? weekStartOf(String(input.week_start))
    : currentWeekStart(tz);

  if (action === "list") {
    const goals = await reconcileWeek(userId, weekStart);
    // Read-only: no notification, so it never licenses a "done" claim.
    return { success: true, data: { weekStart: wallDateString(weekStart), goals } };
  }

  if (action === "set") {
    const label = String(input.label || "").trim();
    const category = String(input.category || "");
    const target = Number(input.target_count);
    if (!label) return { success: false, error: "set needs a `label`." };
    if (!["strength", "mobility", "nutrition", "recovery", "other"].includes(category)) {
      return { success: false, error: `\`category\` must be one of strength, mobility, nutrition, recovery, other — got "${category}".` };
    }
    if (!Number.isFinite(target) || target < 1) {
      return { success: false, error: "set needs a `target_count` of at least 1." };
    }

    const goal = await prisma.weeklyGoal.upsert({
      where: { userId_weekStart_label: { userId, weekStart, label } },
      create: { userId, weekStart, label, category: category as never, targetCount: target },
      update: { category: category as never, targetCount: target },
    });
    const goals = await reconcileWeek(userId, weekStart);
    const mine = goals.find((g) => g.id === goal.id);

    return {
      success: true,
      data: { goal: mine, weekStart: wallDateString(weekStart) },
      notification: {
        type: "goal_set",
        message: `Weekly goal: ${label} ${target}× this week${mine && mine.done > 0 ? ` (${mine.done} already done)` : ""}`,
      },
    };
  }

  if (action === "remove") {
    const label = String(input.label || "").trim();
    if (!label) return { success: false, error: "remove needs a `label`." };
    const { count } = await prisma.weeklyGoal.deleteMany({ where: { userId, weekStart, label } });
    if (count === 0) {
      return { success: false, error: `No goal called "${label}" in the week starting ${wallDateString(weekStart)}. Nothing was removed.` };
    }
    return {
      success: true,
      data: { removed: label },
      notification: { type: "goal_removed", message: `Removed weekly goal: ${label}` },
    };
  }

  if (action === "resolve") {
    const activityId = String(input.activity_id || "");
    if (!activityId) return { success: false, error: "resolve needs an `activity_id`." };
    const goalId = input.goal_id ? String(input.goal_id) : null;
    const res = await resolveCredit(userId, activityId, goalId);
    if (!res.ok) return { success: false, error: res.error };
    return {
      success: true,
      data: { activityId, goalId },
      notification: {
        type: "goal_set",
        message: goalId ? "Session attributed to the right goal" : "Session no longer counts towards a goal",
      },
    };
  }

  return { success: false, error: `Unknown action "${action}". Use set, list, remove or resolve.` };
}
