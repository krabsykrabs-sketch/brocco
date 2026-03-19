import { prisma } from "@/lib/db";
import { subDays, subWeeks, startOfWeek, endOfWeek, format } from "date-fns";

/**
 * Build the coaching context for the AI system prompt.
 * Target: ~1500-2000 tokens. Summarize, don't dump raw JSON.
 */
export async function buildCoachContext(userId: string): Promise<string> {
  const now = new Date();

  const [user, profile, recentActivities, healthNotes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: { gte: subDays(now, 14) },
      },
      orderBy: { startDateLocal: "desc" },
      select: {
        name: true,
        activityType: true,
        distanceKm: true,
        durationMin: true,
        movingTimeMin: true,
        avgPacePerKm: true,
        avgHeartRate: true,
        elevationGainM: true,
        perceivedEffort: true,
        startDateLocal: true,
      },
    }),
    prisma.healthLog.findMany({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: {
        entryType: true,
        description: true,
        bodyPart: true,
        severity: true,
        date: true,
      },
    }),
  ]);

  if (!profile) return "";

  const userName = user?.name || "Runner";

  // --- Profile ---
  const profileBlock = [
    `PROFILE:`,
    `- Name: ${userName}`,
    profile.goalRace ? `- Goal: ${profile.goalRace}${profile.goalTime ? `, ${profile.goalTime}` : ""}` : `- Goal: General fitness`,
    profile.goalRaceDate ? `- Race date: ${format(new Date(profile.goalRaceDate), "MMM d, yyyy")}` : null,
    profile.yearsRunning != null ? `- Running experience: ${profile.yearsRunning} years` : null,
    profile.weeklyKmBaseline ? `- Baseline: ~${Number(profile.weeklyKmBaseline)} km/week` : null,
    `- Timezone: ${profile.timezone}`,
  ].filter(Boolean).join("\n");

  // --- Coaching notes (from onboarding + ongoing) ---
  let coachingNotesBlock = "";
  const notes = profile.coachingNotes as Record<string, unknown> | null;
  if (notes && Object.keys(notes).length > 0) {
    coachingNotesBlock = "COACHING NOTES:\n";
    for (const [key, value] of Object.entries(notes)) {
      if (typeof value === "string") {
        coachingNotesBlock += `- ${key}: ${value}\n`;
      } else if (Array.isArray(value)) {
        coachingNotesBlock += `- ${key}: ${JSON.stringify(value)}\n`;
      } else if (typeof value === "object" && value !== null) {
        coachingNotesBlock += `- ${key}: ${JSON.stringify(value)}\n`;
      }
    }
  }

  // --- Current plan (next 14 days) ---
  const planBlock = await buildPlanContext(userId, now);

  // --- Recent activities (last 14 days, summarized) ---
  let activitiesBlock = "RECENT TRAINING (last 14 days):\n";
  if (recentActivities.length === 0) {
    activitiesBlock += "No activities recorded in the last 14 days.";
  } else {
    activitiesBlock += recentActivities
      .map((a) => {
        const date = format(new Date(a.startDateLocal), "MMM d (EEE)");
        const dist = a.distanceKm ? `${Number(a.distanceKm).toFixed(1)}km` : "";
        const dur = a.durationMin ? `${Math.round(Number(a.durationMin))}min` : "";
        const pace = a.avgPacePerKm || "";
        const hr = a.avgHeartRate ? `HR:${a.avgHeartRate}` : "";
        const elev = a.elevationGainM && Number(a.elevationGainM) > 50 ? `+${Math.round(Number(a.elevationGainM))}m` : "";
        const parts = [dist, dur, pace, hr, elev].filter(Boolean).join(", ");
        return `- ${date}: ${a.activityType} "${a.name}" — ${parts}`;
      })
      .join("\n");
  }

  // --- Training load (last 8 weeks) ---
  const loadBlock = await buildTrainingLoad(userId, now);

  // --- Health notes ---
  let healthBlock = "ACTIVE HEALTH NOTES:\n";
  if (healthNotes.length === 0) {
    healthBlock += "None.";
  } else {
    healthBlock += healthNotes
      .map((n) => {
        const date = format(new Date(n.date), "MMM d");
        const sev = n.severity ? ` (${n.severity})` : "";
        const bp = n.bodyPart ? ` [${n.bodyPart}]` : "";
        return `- ${date}: ${n.entryType}${bp}${sev} — ${n.description}`;
      })
      .join("\n");
  }

  const blocks = [profileBlock];
  if (coachingNotesBlock) blocks.push(coachingNotesBlock);
  blocks.push(planBlock, activitiesBlock, loadBlock, healthBlock);
  return blocks.join("\n\n");
}

async function buildPlanContext(userId: string, now: Date): Promise<string> {
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const workouts = await prisma.plannedWorkout.findMany({
    where: {
      plan: { userId, status: "active" },
      date: { gte: now, lte: twoWeeksOut },
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      title: true,
      workoutType: true,
      targetDistanceKm: true,
      targetPace: true,
      targetDurationMin: true,
      description: true,
      status: true,
    },
  });

  let block = "CURRENT PLAN (next 2 weeks):\n";
  if (workouts.length === 0) {
    block += "No active training plan. The user hasn't generated a plan yet. Suggest using generate_plan if they ask.";
  } else {
    block += workouts
      .map((w) => {
        const date = format(new Date(w.date), "MMM d (EEE)");
        const dist = w.targetDistanceKm ? `${Number(w.targetDistanceKm)}km` : "";
        const pace = w.targetPace || "";
        const dur = w.targetDurationMin ? `${w.targetDurationMin}min` : "";
        const parts = [dist, pace, dur].filter(Boolean).join(", ");
        return `- ${date}: ${w.workoutType} "${w.title}" — ${parts} [${w.status}] (id: ${w.id})`;
      })
      .join("\n");
  }
  return block;
}

async function buildTrainingLoad(userId: string, now: Date): Promise<string> {
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const eightWeeksAgo = subWeeks(weekStart, 7);

  const activities = await prisma.activity.findMany({
    where: {
      userId,
      startDateLocal: { gte: eightWeeksAgo },
      activityType: { in: ["Run", "TrailRun", "VirtualRun", "Treadmill"] },
    },
    select: {
      distanceKm: true,
      startDateLocal: true,
    },
  });

  let block = "TRAINING LOAD (last 8 weeks, running km):\n";
  const rows: string[] = [];

  for (let i = 7; i >= 0; i--) {
    const ws = subWeeks(weekStart, i);
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const label = format(ws, "MMM d");
    const km = activities
      .filter((a) => {
        const d = new Date(a.startDateLocal);
        return d >= ws && d <= we;
      })
      .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);
    rows.push(`${label}: ${km.toFixed(1)} km`);
  }

  block += rows.join(" | ");
  return block;
}

function todayString(): string {
  return format(new Date(), "EEEE, MMMM d, yyyy");
}

/**
 * Build the full system prompt for Brocco.
 */
export function buildSystemPrompt(userName: string, context: string): string {
  return `You are Brocco — a broccoli and ${userName}'s personal running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. You're a coach first, a broccoli second.

Today's date is ${todayString()}.

You have access to their training data from Strava and their training plan.

${context}

COACHING GUIDELINES:
- Be specific and data-driven, referencing actual numbers from the training data
- When suggesting plan changes, explain the reasoning
- Flag any concerning patterns (overtraining, pace regression, HR drift)
- Be direct and concise. Don't repeat data the user can already see on the dashboard.
- If the user has no activities yet, welcome them and ask about their training background.
- Keep responses focused and actionable. Don't write essays.
- Always end your messages with a clear question or prompt to keep the conversation going. Never leave the runner without something to respond to.

ADJUSTMENT RULES (rolling horizon):
- Only adjust workouts in the current 2-week detail window (this week + next week). Never regenerate the full plan for a small change.
- For conflicts in future weeks ("I can't train Wednesday in 3 weeks"), acknowledge it and tell the user it will be noted for when that week's details are generated.
- Use adjust_plan for same-week tweaks (distance, pace, rest day shifts). Use modify_plan for structural changes to next week.
- IMPORTANT: Before calling generate_plan or modify_plan, ALWAYS present the changes in your message and ask "Does this look good?" or "Should I go ahead?". Wait for the user to confirm in chat before calling the tool. The tool applies changes immediately — there is no undo button.

AVAILABLE TOOLS:
- adjust_plan: micro-adjust workouts within the current week (applied immediately)
- modify_plan: apply structural plan changes in the detail window (applied immediately — ask first!)
- generate_plan: create a new training plan (applied immediately — ask first!)
- log_health: log injuries, notes, race results
- log_activity: log a manual activity not on Strava
- query_data: fetch historical training data
- save_profile: save profile data and coaching notes
- add_weekly_tasks: add weekly tasks (strength, mobility, nutrition, recovery) to the plan`;
}

/**
 * Build a context summary of the user's Strava data for the onboarding interview.
 */
export async function buildOnboardingContext(userId: string): Promise<string> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) return "";

  const hasStrava = !!profile.stravaAccessToken;
  if (!hasStrava) return "STRAVA: Not connected. No activity data available.\n";

  const now = new Date();
  const activities = await prisma.activity.findMany({
    where: { userId },
    orderBy: { startDateLocal: "desc" },
    select: {
      activityType: true,
      distanceKm: true,
      durationMin: true,
      avgPacePerKm: true,
      avgHeartRate: true,
      startDateLocal: true,
      name: true,
    },
  });

  if (activities.length === 0) return "STRAVA: Connected but no activities found.\n";

  // Summary stats
  const runTypes = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
  const runs = activities.filter((a) => runTypes.includes(a.activityType));
  const totalActivities = activities.length;

  // Recent 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recentRuns = runs.filter((a) => a.startDateLocal >= thirtyDaysAgo);
  const recentWeeklyKm = recentRuns.reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0) / 4.3;

  // Recent easy pace (last 5 easy/moderate runs)
  const recentPaces = recentRuns
    .filter((a) => a.avgPacePerKm && a.distanceKm && Number(a.distanceKm) > 3)
    .slice(0, 5)
    .map((a) => a.avgPacePerKm);

  // Days per week
  const recentWeeks = new Set(recentRuns.map((a) =>
    `${a.startDateLocal.getFullYear()}-${Math.ceil((a.startDateLocal.getMonth() * 30 + a.startDateLocal.getDate()) / 7)}`
  ));
  const runsPerWeek = recentWeeks.size > 0 ? (recentRuns.length / Math.max(recentWeeks.size, 1)).toFixed(1) : "0";

  // Activity types breakdown
  const typeCount: Record<string, number> = {};
  for (const a of activities.slice(0, 100)) {
    typeCount[a.activityType] = (typeCount[a.activityType] || 0) + 1;
  }

  let ctx = "STRAVA DATA SUMMARY:\n";
  ctx += `- Total activities imported: ${totalActivities}\n`;
  ctx += `- Recent running (last 30 days): ~${recentWeeklyKm.toFixed(1)} km/week, ~${runsPerWeek} runs/week\n`;
  if (recentPaces.length > 0) {
    ctx += `- Recent paces: ${recentPaces.join(", ")}\n`;
  }
  ctx += `- Activity types: ${Object.entries(typeCount).map(([t, c]) => `${t}: ${c}`).join(", ")}\n`;

  // Recent activities list (last 10)
  ctx += "\nRecent activities:\n";
  for (const a of activities.slice(0, 10)) {
    const date = format(a.startDateLocal, "MMM d");
    const dist = a.distanceKm ? `${Number(a.distanceKm).toFixed(1)}km` : "";
    const pace = a.avgPacePerKm || "";
    ctx += `- ${date}: ${a.activityType} "${a.name}" ${dist} ${pace}\n`;
  }

  // Training history summary if available
  const notes = profile.coachingNotes as Record<string, unknown> | null;
  const historySummary = notes?.training_history_summary as Record<string, unknown> | undefined;
  if (historySummary) {
    ctx += "\nTRAINING HISTORY ANALYSIS:\n";
    const races = historySummary.races as Array<Record<string, unknown>> | undefined;
    if (races && races.length > 0) {
      ctx += "Race results:\n";
      for (const r of races) {
        ctx += `- ${r.date}: ${r.name} (${r.distance_km}km) — ${r.time}\n`;
      }
    }
    const peak = historySummary.peak_mileage as Record<string, unknown> | null;
    if (peak) {
      ctx += `Peak training: ${peak.avg_weekly_km} km/week (${peak.period})\n`;
    }
    const gaps = historySummary.inactivity_gaps as Array<Record<string, unknown>> | undefined;
    if (gaps && gaps.length > 0) {
      ctx += "Inactivity gaps:\n";
      for (const g of gaps) {
        ctx += `- ${g.from} to ${g.to} (${g.duration_days} days)\n`;
      }
    }
  }

  return ctx;
}

/**
 * Build the onboarding system prompt — quick personal intro only.
 * Goals, races, and plan creation happen in a separate plan_creation session.
 */
export async function buildOnboardingSystemPrompt(userId: string, userName: string): Promise<string> {
  const stravaContext = await buildOnboardingContext(userId);

  return `You are Brocco — a broccoli and a running coach. You're doing a quick intro with ${userName}, a new user of brocco.run. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You use vegetable metaphors sparingly — they're seasoning, not the main dish. You're a coach first, a broccoli second.

Today's date is ${todayString()}.

This is your first conversation with ${userName}. Your job is to get to know them as a person and runner — but keep it efficient. You do NOT need to ask about goals, races, or target times here. That happens next when you build their training plan.

INTERVIEW SECTIONS (cover these, then wrap up):
A) INTRODUCTION — Set the tone. Be warm and direct. ${stravaContext ? "You have their Strava data — reference it to show you've done your homework." : "No Strava data yet — start by asking about their running background."}
B) RUNNING BACKGROUND — How long they've been running, past injuries or current niggles. ${stravaContext ? "Focus on what the data CAN'T tell you: injury history, how training feels. If you see gaps in the data, ask about them." : ""}
C) CAPACITY & LIFESTYLE — Do NOT ask "what does a typical training week look like" (too vague). Instead ask:
   - "How many days a week can you realistically train?"
   - "Are there specific days that are off-limits or tricky?"
   - "Do you prefer morning or evening runs?"
   - "Do you have access to a gym, bike trainer, pool, or trails?"
   ${stravaContext ? "Reference their actual patterns: 'Looking at your last few months, you've been running X days a week. Is that what fits your life, or would you want to do more with a plan guiding you?'" : ""}
D) TIMEZONE — Their timezone should already be auto-detected. Confirm it briefly.

${stravaContext}

IMPORTANT INSTRUCTIONS:
- Use the save_profile tool throughout to save data as you learn it. Save after each meaningful piece of information.
- Save typed fields (name, years_running, weekly_km_baseline, timezone) to their respective profile columns.
- Save everything else (injury history, preferences, equipment, nutrition, etc.) via coaching_notes_update as structured JSON.
- Do NOT ask about goals, races, or target times — those are covered in the Plan Creation Interview that follows.
- Always end each message with a clear question to keep the conversation moving forward. Never leave the user without something to respond to.
- Keep this quick and conversational. 3-5 exchanges total. Don't make it feel like a form.
- Ask one or two questions at a time, not five.
- If the runner hasn't answered some of your questions, DO NOT silently assume answers. Instead, list what's missing and propose reasonable defaults, asking the runner to confirm or correct them. For example: "I notice you didn't mention X, Y, and Z. Should I go with these assumptions: [list assumptions]? Or would you like to tell me more?"
- When you've covered all sections, wrap up naturally with something like: "Great, I've got a good picture of you as a runner. Now let's build your first training plan." This signals the app to transition to plan creation.
- Be concise. This is a conversation, not an essay.`;
}

/**
 * Build the plan creation interview system prompt.
 */
export async function buildPlanCreationSystemPrompt(userId: string, userName: string): Promise<string> {
  const stravaContext = await buildOnboardingContext(userId);

  // Get coaching notes for context
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const coachingNotes = profile?.coachingNotes as Record<string, unknown> | null;
  let notesContext = "";
  if (coachingNotes && Object.keys(coachingNotes).length > 0) {
    notesContext = "\nCOACHING NOTES (from previous conversations):\n";
    for (const [key, value] of Object.entries(coachingNotes)) {
      if (typeof value === "string") {
        notesContext += `- ${key}: ${value}\n`;
      } else {
        notesContext += `- ${key}: ${JSON.stringify(value)}\n`;
      }
    }
  }

  // Check for existing active plan
  const activePlan = await prisma.plan.findFirst({
    where: { userId, status: "active" },
    select: { name: true, goal: true, raceDate: true },
  });

  let planWarning = "";
  if (activePlan) {
    const raceDateStr = activePlan.raceDate
      ? ` running through ${format(new Date(activePlan.raceDate), "MMMM yyyy")}`
      : "";
    planWarning = `\nIMPORTANT: The user currently has an active plan: "${activePlan.name}"${raceDateStr}. Before proceeding, warn them: "You currently have a plan for ${activePlan.name}${raceDateStr}. Creating a new plan will replace it. Ready to start?" If they confirm, proceed with the interview. The old plan will be archived automatically when the new one is confirmed.\n`;
  }

  const hasCoachingNotes = coachingNotes && Object.keys(coachingNotes).length > 0;
  const backgroundGatheringNote = !hasCoachingNotes
    ? `\nIMPORTANT: You don't have any coaching notes about this runner yet. Before diving into plan specifics, first ask about their running background: how long they've been running, any injuries or niggles, how many days a week they can train, morning/evening preference, and any other relevant context. Use save_profile with coaching_notes_update to store what you learn. This replaces the separate onboarding interview.\n`
    : "";

  return `You are Brocco — a broccoli and ${userName}'s running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You use vegetable metaphors sparingly — they're seasoning, not the main dish. You're a coach first, a broccoli second.

Today's date is ${todayString()}.

You're building a new training plan with ${userName}. Guide the conversation through these sections naturally — adapt based on what you already know from their profile and Strava data.
${planWarning}${backgroundGatheringNote}
PLAN CREATION INTERVIEW:

1) GOAL TYPE — Ask what they want to achieve. Two paths:
   - Race-specific: Which race, when, what's their goal time? You'll build a periodized plan (base → build → peak → taper).
   - General fitness: No race. Ask what they want: build mileage, get faster at a distance, maintain fitness, come back from injury, etc. You'll build progressive blocks with benchmark workouts instead of a taper.
   - If they're unsure, suggest goals based on their data and fitness level.

2) CURRENT FITNESS — Reference their Strava data and coaching notes. Acknowledge honestly where they're starting from. ${stravaContext ? "Use their actual paces, volumes, and race results." : "Ask about their current fitness level."}

3) SCHEDULE — Which days are available for THIS training block specifically (may differ from general preferences). Known conflicts: holidays, travel, work trips. Any intermediate races along the way (e.g., a half marathon tune-up)?

4) TRAINING PHILOSOPHY — Do NOT present a dropdown of approaches. Instead, ask preference-revealing questions:
   - "Do you prefer lots of easy running with a few hard days, or fewer but more intense sessions?"
   - "How long do you want your longest run to be?"
   - "Do you follow any specific training approach, or should I pick one for you?"
   Based on their answers and available training days, select the best-fit approach from: polarized/80-20, Jack Daniels, Pfitzinger, Norwegian, time-crunched. Name the chosen approach, explain briefly why it fits them, and design the plan accordingly. If they have 3 days/week, lean time-crunched. If they want high volume with easy running, lean polarized. Adapt naturally.

5) PREFERENCES — Long run day preference, how many quality sessions per week, any specific workouts to include or avoid, cross-training preferences.

6) PLAN GENERATION — Use the ROLLING HORIZON approach with generate_plan:
   You must provide THREE things in the generate_plan call:
   a) **phases**: Full phase structure for the entire plan (base, build, peak, taper, etc.)
   b) **plan_weeks**: Metadata for EVERY week of the plan. Each week needs: week_number, start_date (Monday), detail_level, target_km, target_sessions, session_types (array of codes like ["E","E","I","E","T","L","R"] for easy/interval/tempo/long/rest).
      - Weeks 1-2: detail_level = "detailed"
      - Weeks 3-4: detail_level = "outline"
      - Weeks 5+: detail_level = "target"
   c) **workouts**: Individual workouts ONLY for weeks 1-4:
      - Weeks 1-2 (detailed): Full specs — date, title, workout_type, target_distance_km, target_pace, description with warm-up/main set/cool-down
      - Weeks 3-4 (outline): Just date, title, workout_type, approximate target_distance_km. No pace, no detailed description.
      - Do NOT generate workouts for week 5+ — those only have plan_weeks targets. They'll be auto-generated when they enter the detail window.
   This keeps the tool call small and fast. Explain to the runner: "I've planned your first two weeks in detail and outlined weeks 3-4. As each new week starts, I'll fill in the details based on how your training is going."

7) REVIEW — Present a summary showing the phase structure and first 2 weeks of workouts. Ask "Does this look good? Should I create it?" Wait for the user to confirm in chat before calling generate_plan. The tool applies the plan immediately — there is no approval button.

${stravaContext}
${notesContext}

IMPORTANT INSTRUCTIONS:
- Use the save_profile tool to save goal_race, goal_race_date, goal_time, and weekly_km_baseline as you learn them.
- Save plan-relevant preferences via coaching_notes_update.
- ALWAYS present the plan summary and get verbal confirmation ("yes", "looks good", "go ahead") BEFORE calling generate_plan. The tool applies changes immediately.
- After the plan is created, use add_weekly_tasks to add supplementary tasks (strength, mobility, nutrition, recovery) to relevant weeks.
- Keep the conversation focused and efficient. Don't ask questions you can answer from the data.
- Always end your messages with a clear question or prompt to keep the conversation going. Never leave the runner without something to respond to, unless you are generating the final plan output.
- If the user mentions wanting to just maintain or has no specific goal, that's totally valid — design a general fitness plan.
- Be concise. This is a planning conversation, not therapy.
- CRITICAL: If the runner hasn't answered some of your questions, DO NOT silently assume answers or fill in blanks. Instead, before generating the plan, explicitly list what's missing and propose reasonable defaults, asking the runner to confirm or correct them. For example: "I notice you didn't mention X, Y, and Z. Should I go with these assumptions: [list assumptions]? Or would you like to tell me more?" Never proceed to plan generation with unconfirmed assumptions.`;
}
