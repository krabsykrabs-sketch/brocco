import { prisma } from "@/lib/db";
import { subDays, subWeeks, startOfWeek, endOfWeek, format, addDays } from "date-fns";
import {
  getAgenda,
  renderAgendaText,
  getUpcomingBirthdays,
  todayInTimezone,
  parseWall,
  wallDateString,
  formatDateShort,
  addDaysWall,
} from "@/lib/schedule";
import type { ActivityAnalysis } from "@/lib/heart-rate-analysis";
import { resolveFeatures, anyLifeFeature, type Features } from "@/lib/features";
import { renderJournalText, averageMood } from "@/lib/journal";

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
        activityAnalysis: true,
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

  // --- Coaching notes ---
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
        const intensity = formatIntensityAnnotation(a.activityAnalysis);
        return `- ${date}: ${a.activityType} "${a.name}" — ${parts}${intensity}`;
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

  // --- Life planner: schedule + tasks + birthdays (next 7 days) ---
  // Respects the user's feature toggles — with everything off, Brocco's
  // context is the classic coach package.
  const features = resolveFeatures(profile.features);
  const blocks = [profileBlock];
  if (coachingNotesBlock) blocks.push(coachingNotesBlock);
  blocks.push(planBlock, activitiesBlock, loadBlock, healthBlock);
  if (features.calendar || features.tasks) {
    blocks.push(await buildLifeContext(userId, profile.timezone, features));
  }
  if (features.journal) {
    const journalBlock = await buildJournalContext(userId, profile.timezone);
    if (journalBlock) blocks.push(journalBlock);
  }
  return blocks.join("\n\n");
}

/**
 * Recent mood/journal signal (last 7 days) so Brocco can connect how the
 * user feels with how they're training. Omitted entirely when there are no
 * entries — no block is better than an empty one.
 */
async function buildJournalContext(userId: string, timezone: string): Promise<string | null> {
  const today = todayInTimezone(timezone);
  const weekAgo = wallDateString(addDaysWall(parseWall(today), -7));
  const entries = await prisma.journalEntry.findMany({
    where: { userId, day: { gte: weekAgo } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { day: true, mood: true, tags: true, text: true },
  });
  if (entries.length === 0) return null;

  const avg = averageMood(entries);
  let block = `MOOD & JOURNAL (private, last 7 days, 1=rough..5=great${avg != null ? `, average ${avg}/5` : ""}):\n`;
  block += renderJournalText(entries);
  block += `\n(Use log_journal to record new moods/reflections. Reference this gently — it's their diary, not a metric to optimize.)`;
  return block;
}

/**
 * Schedule context: today + next 7 days of events and due tasks, plus upcoming
 * birthdays — each domain gated by the user's feature toggles. Workouts are
 * omitted here; they're already in the plan block.
 */
async function buildLifeContext(userId: string, timezone: string, features: Features): Promise<string> {
  const today = todayInTimezone(timezone);
  const weekOut = wallDateString(addDaysWall(parseWall(today), 7));

  const [agenda, birthdays, openTaskCount] = await Promise.all([
    getAgenda(userId, today, weekOut, { includeOverdueTodos: true, today }),
    features.calendar ? getUpcomingBirthdays(userId, today, 14) : Promise.resolve([]),
    features.tasks ? prisma.todo.count({ where: { userId, done: false } }) : Promise.resolve(0),
  ]);

  // Drop workouts (plan block covers them) and any disabled domains
  const scheduleText = renderAgendaText({
    ...agenda,
    workouts: [],
    events: features.calendar ? agenda.events : [],
    todos: features.tasks ? agenda.todos : [],
  });

  let block = `SCHEDULE & TASKS (today ${today} through ${weekOut}, times are the user's local time):\n`;
  block += scheduleText;
  if (features.tasks) {
    block += `\n(${openTaskCount} open task${openTaskCount === 1 ? "" : "s"} in total — use query_schedule or the Tasks views for more.)`;
  }

  if (birthdays.length > 0) {
    block += "\n\nUPCOMING BIRTHDAYS:\n";
    block += birthdays
      .map((b) => `- ${b.title} — ${formatDateShort(b.date)} (${b.daysUntil === 0 ? "TODAY" : `in ${b.daysUntil} day${b.daysUntil === 1 ? "" : "s"}`})${b.notes ? ` — ${b.notes}` : ""}`)
      .join("\n");
  }

  return block;
}

function formatPaceShort(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

/**
 * Compact intensity annotation appended to a recent-activity line — only
 * for activities that have something worth flagging (plan mismatch,
 * meaningful cardiac drift, or a detected hard effort). Unremarkable runs
 * get no annotation, keeping the 14-day block within the token budget even
 * though every run may now carry an activity_analysis blob.
 */
function formatIntensityAnnotation(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const a = raw as ActivityAnalysis;
  const parts: string[] = [];

  if (a.effortVsPlanned === "harder_than_planned") parts.push("⚠ ran harder than planned");
  else if (a.effortVsPlanned === "easier_than_planned") parts.push("⚠ ran easier than planned");

  if (a.decouplingPct != null && Math.abs(a.decouplingPct) >= 5) {
    parts.push(`cardiac drift ${a.decouplingPct > 0 ? "+" : ""}${a.decouplingPct}%`);
  }

  if (a.effortSegments.length > 0) {
    const paces = a.effortSegments.map((s) => s.paceSecPerKm).filter((p): p is number => p != null);
    const hrs = a.effortSegments.map((s) => s.avgHr).filter((h): h is number => h != null);
    const avgPace = paces.length ? Math.round(paces.reduce((s, x) => s + x, 0) / paces.length) : null;
    const avgHr = hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : null;
    const label = a.effortSegments.length > 1 ? `${a.effortSegments.length}x hard reps` : "hard block";
    parts.push(`${label}${avgPace ? ` @${formatPaceShort(avgPace)}` : ""}${avgHr ? ` HR${avgHr}` : ""}`);
  } else if (a.zones && a.zones.z4Pct + a.zones.z5Pct >= 15 && !parts.some((p) => p.includes("harder"))) {
    // No distinct effort block, but a meaningful chunk of the run was hard anyway
    parts.push(`${Math.round(a.zones.z4Pct + a.zones.z5Pct)}% in Z4-5`);
  }

  return parts.length > 0 ? ` [${parts.join("; ")}]` : "";
}

async function buildPlanContext(userId: string, now: Date): Promise<string> {
  const plan = await prisma.plan.findFirst({
    where: { userId, status: "active" },
    select: { id: true, name: true },
  });

  if (!plan) {
    return "CURRENT PLAN:\nNo active training plan. The user hasn't generated a plan yet. Suggest using generate_plan if they ask.";
  }

  // Determine current week position. Use plan_weeks if available, fall back to planned_workouts.
  const allPlanWeeks = await prisma.planWeek.findMany({
    where: { planId: plan.id },
    orderBy: { weekNumber: "asc" },
    include: { phase: { select: { name: true } } },
  });

  const todayStr = format(now, "yyyy-MM-dd");
  let currentWeekNum: number | null = null;
  let currentWeekStart: string | null = null;
  let currentWeekEnd: string | null = null;
  let currentPhaseName: string | null = null;
  let totalWeeks = 0;
  let completedWeeks = 0;

  if (allPlanWeeks.length > 0) {
    // Use plan_weeks as source of truth
    totalWeeks = allPlanWeeks.length;
    for (const pw of allPlanWeeks) {
      const ws = format(new Date(pw.startDate), "yyyy-MM-dd");
      const weDate = new Date(new Date(pw.startDate).getTime() + 6 * 86400000);
      const we = format(weDate, "yyyy-MM-dd");
      if (todayStr >= ws && todayStr <= we) {
        currentWeekNum = pw.weekNumber;
        currentWeekStart = format(new Date(pw.startDate), "MMM d");
        currentWeekEnd = format(weDate, "MMM d");
        currentPhaseName = pw.phase?.name || null;
      }
    }
    if (currentWeekNum !== null) {
      completedWeeks = allPlanWeeks.filter((w) => w.weekNumber < currentWeekNum!).length;
    }
  } else {
    // Fall back: derive week info from planned_workouts.week_number
    const weekWorkouts = await prisma.plannedWorkout.findMany({
      where: { planId: plan.id },
      orderBy: { date: "asc" },
      select: { weekNumber: true, date: true },
    });

    // Group by week_number to find date ranges
    const weekMap = new Map<number, { minDate: Date; maxDate: Date }>();
    for (const w of weekWorkouts) {
      const d = new Date(w.date);
      const existing = weekMap.get(w.weekNumber);
      if (!existing) {
        weekMap.set(w.weekNumber, { minDate: d, maxDate: d });
      } else {
        if (d < existing.minDate) existing.minDate = d;
        if (d > existing.maxDate) existing.maxDate = d;
      }
    }

    totalWeeks = weekMap.size;
    for (const [wn, { minDate, maxDate }] of weekMap) {
      const ws = format(minDate, "yyyy-MM-dd");
      const we = format(maxDate, "yyyy-MM-dd");
      if (todayStr >= ws && todayStr <= we) {
        currentWeekNum = wn;
        currentWeekStart = format(minDate, "MMM d");
        currentWeekEnd = format(maxDate, "MMM d");
      }
    }
    if (currentWeekNum !== null) {
      completedWeeks = Array.from(weekMap.keys()).filter((wn) => wn < currentWeekNum!).length;
    }
  }

  // Build the explicit week position line
  let block = "CURRENT PLAN:\n";
  if (currentWeekNum !== null) {
    const phaseStr = currentPhaseName ? ` Phase: ${currentPhaseName}.` : "";
    block += `CURRENT WEEK: Week ${currentWeekNum} of ${totalWeeks} (${currentWeekStart}-${currentWeekEnd}).${phaseStr} ${completedWeeks} week${completedWeeks !== 1 ? "s" : ""} completed.\n\n`;
  }

  // Get workouts for next 2 weeks
  const twoWeeksOut = new Date(now);
  twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);

  const workouts = await prisma.plannedWorkout.findMany({
    where: {
      planId: plan.id,
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

  block += "Upcoming workouts (next 2 weeks):\n";
  if (workouts.length === 0) {
    block += "No workouts scheduled in the next 2 weeks.";
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

function todayString(timezone?: string): string {
  if (timezone) {
    const todayStr = todayInTimezone(timezone);
    return format(parseWall(todayStr), "EEEE, MMMM d, yyyy");
  }
  return format(new Date(), "EEEE, MMMM d, yyyy");
}

/**
 * Build the full system prompt for Brocco.
 * mode "chat" = full conversation (status lines, coaching interview flows).
 * mode "capture" = voice quick-capture: terse, act immediately, no status line.
 */
export async function buildSystemPrompt(
  userId: string,
  userName: string,
  context: string,
  mode: "chat" | "capture" = "chat"
): Promise<string> {
  // Check coaching notes to determine if background gathering is needed
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const coachingNotes = profile?.coachingNotes as Record<string, unknown> | null;
  const hasCoachingNotes = coachingNotes && Object.keys(coachingNotes).length > 0;

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
    planWarning = `\nNOTE: The runner currently has an active plan: "${activePlan.name}"${raceDateStr}. If they want a new plan, warn them: "You currently have a plan for ${activePlan.name}${raceDateStr}. Creating a new plan will replace it. Ready to start?" The old plan will be archived automatically when the new one is confirmed.\n`;
  }

  // Feature toggles shape Brocco's persona: with everything disabled this is
  // the classic running-coach prompt, with no life-admin capabilities offered.
  const life = resolveFeatures(profile?.features);
  const isLife = anyLifeFeature(life);
  const lifeDomains = [
    life.calendar && "calendar",
    life.tasks && "tasks",
    life.notes && "notes",
    life.journal && "mood journal",
    life.kitchen && "kitchen & recipes",
    life.calendar && "important dates",
  ].filter(Boolean).join(", ");

  const identityLine = isLife
    ? `You are Brocco — a broccoli, ${userName}'s personal running coach, and the assistant who runs their day-to-day life: ${lifeDomains}. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish, and you keep them out of plain life admin (confirming a dentist appointment needs no broccoli joke). You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You're a coach first, a broccoli second, and always one single assistant — the user never has to pick a "mode".`
    : `You are Brocco — a broccoli and ${userName}'s personal running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. You're a coach first, a broccoli second.`;

  const accessLine = `You have access to their training data from Strava and their training plan${
    [life.calendar && "their calendar", life.tasks && "their tasks", life.notes && "their notes", life.journal && "their mood journal", life.kitchen && "their recipe library"]
      .filter(Boolean).map((s) => `, ${s}`).join("")
  }.`;

  const routingLines = [
    life.calendar && "- Appointments, meetings, social plans, travel, anything with a date AND a time/place → manage_event",
    life.calendar && "- Birthdays and yearly dates → manage_event (category birthday, all-day, yearly recurrence)",
    life.tasks && '- To-dos, reminders, errands, shopping items ("remind me to...", "I need to...", "groceries: milk, eggs") → manage_task',
    life.notes && '- Facts and reference info to remember ("my locker code is 4821", "packing list for Mallorca") → manage_note',
    life.journal && '- Feelings, moods, and day reflections ("feeling flat today", "what a great day") → log_journal (mood 1-5 and/or their words as text). Private diary, NOT a place for facts.',
    life.journal && "- When the user mentions feeling tired, stressed, or great, log it — and if mood has been low alongside heavy training, say so gently (data, not diagnosis; you're a coach, not a therapist).",
    "- Runs and training sessions → the training plan tools (adjust_plan/modify_plan), NEVER calendar events",
    '- "Make me a workout" / "something for my core" → create_workout (a playable guided session with timer + voice cues), not a note or task',
    life.kitchen && '- "What can I cook?" / "I have zucchini, eggs, feta" → manage_recipe search FIRST (prefer their saved recipes), then suggest. A vegetable helping with dinner is your moment — but keep suggestions practical and match them to training (carbs before long runs, protein after strength).',
    life.kitchen && '- "Save that recipe" / user dictates a recipe → manage_recipe save. Recipes stay in their original language.',
    (life.calendar || life.tasks) && '- "What does my Thursday look like?" / free-slot questions → query_schedule first, then answer',
    '- Resolve relative dates ("Thursday", "tomorrow", "next week") against today\'s date above. If "Thursday" is ambiguous between tomorrow and next week, ask — one short question.',
  ].filter(Boolean).join("\n");

  const routingBlock = isLife
    ? `\nROUTING — pick the right tool without making the user name the feature:\n${routingLines}\n`
    : "";

  const crossDomainBlock = life.calendar
    ? `\nCROSS-DOMAIN AWARENESS (your signature move):
You see training AND life in one place — use it. Before adding events, and when the plan changes, check the schedule (context above, or query_schedule for other dates) and flag collisions: "Your long run is Saturday morning but you've got a 7am flight — want me to move the run to Friday?" Mention conflicts proactively; offer a concrete fix; let the user decide. Same for fatigue-vs-life logic: a packed work week or late social events around hard sessions are worth a comment.\n`
    : "";

  const identity = `${identityLine}

Today's date is ${todayString(profile?.timezone)}. All times are the user's local time (${profile?.timezone || "Europe/Berlin"}).

${accessLine}

${context}
${routingBlock}${crossDomainBlock}
COACHING GUIDELINES:`;

  return `${identity}
- Be specific and data-driven, referencing actual numbers from the training data
- When suggesting plan changes, explain the reasoning
- Flag any concerning patterns (overtraining, pace regression, HR drift)
- Be direct and concise. Don't repeat data the user can already see on the dashboard.
- If the user has no activities yet, welcome them and ask about their training background.
- Keep responses focused and actionable. Don't write essays.
- Always end your messages with a clear question or prompt to keep the conversation going. Never leave the runner without something to respond to.
${!hasCoachingNotes ? `
GETTING TO KNOW A NEW RUNNER:
If you don't have coaching notes about this runner yet, before diving into plan creation, first ask about their running background: how long they've been running, any injuries or niggles, how many days a week they can train, morning/evening preference. Use save_profile with coaching_notes_update to store what you learn. Keep it quick and conversational — 3-5 exchanges, one or two questions at a time.
` : ""}
PLAN CREATION:
When the runner asks you to create a training plan, conduct a structured interview:
${planWarning}
1) GOAL TYPE — Ask what they want to achieve:
   - Race-specific: Which race, when, goal time? You'll build a periodized plan (base → build → peak → taper).
   - General fitness: No race. Ask what they want: build mileage, get faster, maintain fitness, come back from injury. You'll build progressive blocks with benchmark workouts.
   - If they're unsure, suggest goals based on their data and fitness level.

2) CURRENT FITNESS — Reference their Strava data and coaching notes. Acknowledge honestly where they're starting from.

3) SCHEDULE — Which days are available for this training block. Known conflicts: holidays, travel, work trips. Any intermediate races along the way?

4) TRAINING PHILOSOPHY — Do NOT present a dropdown of approaches. Instead, ask preference-revealing questions:
   - "Do you prefer lots of easy running with a few hard days, or fewer but more intense sessions?"
   - "How long do you want your longest run to be?"
   - "Do you follow any specific training approach, or should I pick one for you?"
   Based on answers, select the best-fit approach from: polarized/80-20, Jack Daniels, Pfitzinger, Norwegian, time-crunched. Name the chosen approach, explain briefly why it fits, and design the plan accordingly.

5) PREFERENCES — Long run day preference, quality sessions per week, specific workouts to include/avoid, cross-training preferences.

6) PLAN GENERATION — Use the ROLLING HORIZON approach with generate_plan:
   Provide THREE things in the generate_plan call:
   a) **phases**: Full phase structure for the entire plan (base, build, peak, taper, etc.)
   b) **plan_weeks**: Metadata for EVERY week. Each week: week_number, start_date (Monday), detail_level, target_km, target_sessions, session_types.
      - Weeks 1-2: detail_level = "detailed"
      - Weeks 3-4: detail_level = "outline"
      - Weeks 5+: detail_level = "target"
   c) **workouts**: Individual workouts ONLY for weeks 1-4:
      - Weeks 1-2 (detailed): Full specs — date, title, workout_type, target_distance_km, target_pace, description
      - Weeks 3-4 (outline): Just date, title, workout_type, approximate target_distance_km
      - Do NOT generate workouts for week 5+
   Explain to the runner: "I've planned your first two weeks in detail and outlined weeks 3-4. As each new week starts, I'll fill in the details based on how your training is going."

7) REVIEW — Present a summary showing the phase structure and first 2 weeks of workouts. Ask "Does this look good? Should I create it?" Wait for confirmation before calling generate_plan. The tool applies the plan immediately.

Flag any unanswered questions with proposed defaults before generating the plan. For example: "I notice you didn't mention X, Y, and Z. Should I go with these assumptions: [list]?" Never proceed to plan generation with unconfirmed assumptions.

STRENGTH & CONDITIONING — every plan includes it:
Unless the runner declines, weave 1-2 short S&C sessions per week into the plan as workouts (workout_type "strength", activity_type "strength", target_duration_min 15-25, title like "S&C: Core & Hips"). Place them on easy or rest days, never before hard sessions. Rotate focus across the block: core/trunk, hips & glutes, calves & ankles, full body — biased toward the runner's injury history. Each strength workout in the plan gets a tap-to-start guided timer session automatically, so keep descriptions short ("core + hip stability circuit") rather than listing exercises.

After the plan is created, use add_weekly_tasks to add supplementary tasks (mobility, nutrition, recovery) to relevant weeks — not strength, which now lives in the plan itself.

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
- add_weekly_tasks: add weekly tasks (strength, mobility, nutrition, recovery) to the plan
- create_workout: build a guided S&C session the user can play in the workout timer (Workouts screen)
${[
  life.calendar && "- manage_event: create/update/delete calendar events and birthdays (applied immediately)",
  life.tasks && "- manage_task: create/update/complete/delete tasks and task lists (applied immediately)",
  life.notes && "- manage_note: save/update/search/delete notes",
  life.journal && "- log_journal: log the user's mood (1-5) and private diary reflections, or read recent ones",
  life.kitchen && "- manage_recipe: search/get/save/delete recipes in their kitchen library; log when they cooked one",
  (life.calendar || life.tasks) && "- query_schedule: read calendar + tasks + workouts for any date range",
].filter(Boolean).join("\n")}

STATUS LINES:
At the end of every message, include a status line that summarizes the key takeaway or next step. Wrap it in a tag like this:

[STATUS:question]Your question or what you need from the runner[/STATUS] — when you're asking the runner something or need confirmation
[STATUS:done]What was completed[/STATUS] — when you've completed an action (plan created, workout adjusted, profile updated, health logged)
[STATUS:info]Key insight or reminder[/STATUS] — when sharing analysis, advice, or information that doesn't require a response

Keep the status text short — one line, max 10-15 words. Examples:
[STATUS:question]Does this plan look good? Say yes to build it.[/STATUS]
[STATUS:question]How many days per week can you train?[/STATUS]
[STATUS:done]Plan created! Check your Plan tab.[/STATUS]
[STATUS:done]Workout adjusted — Friday is now a rest day.[/STATUS]
[STATUS:info]Your pace is trending faster — great progress.[/STATUS]
[STATUS:info]Tomorrow's long run is the key session this week.[/STATUS]

Always include exactly one status line at the very end of your message. Never skip it.${mode === "capture" ? `

QUICK CAPTURE MODE — OVERRIDES EVERYTHING ABOVE ABOUT MESSAGE STYLE:
This message is a voice quick-capture, not a chat conversation. The user spoke into the mic from some screen of the app and expects the action to just happen.
- Execute the right tool call IMMEDIATELY. Do not ask for confirmation on event/task/note creation — these are instantly editable and low-risk. (Plan generation and structural plan changes still require confirmation — in capture mode, tell the user to open the chat for that.)
- After the tool call, reply with ONE short sentence at most. Often zero — the toast already confirms the action. Add a sentence only if there's something genuinely worth saying (e.g. a conflict you spotted: "Heads up — that overlaps your long run Saturday.").
- If the request is ambiguous in a way that matters (which Thursday? which "that"?), do NOT guess and do NOT call a tool. Reply with exactly one short clarifying question and nothing else.
- If it's a question ("what's my locker code?", "what's tomorrow looking like?"), use the tools to find the answer and reply with the answer in 1-2 short sentences.
- A SCREEN CONTEXT block in the user message tells you what they're looking at. "Move that to 5pm" while viewing a specific event means THAT event. Captures from the calendar default to that visible week.
- NO status lines, NO greetings, NO follow-up questions, NO vegetable metaphors in capture mode.` : ""}`;
}

/**
 * Build a context summary of the user's Strava data for plan creation context.
 */
async function buildStravaContext(userId: string): Promise<string> {
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

