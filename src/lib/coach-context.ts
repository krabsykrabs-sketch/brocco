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

/**
 * Build the full system prompt for Brocco.
 */
export function buildSystemPrompt(userName: string, context: string): string {
  return `You are Brocco — a broccoli and ${userName}'s personal running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. You're a coach first, a broccoli second.

You have access to their training data from Strava and their training plan.

${context}

COACHING GUIDELINES:
- Be specific and data-driven, referencing actual numbers from the training data
- When suggesting plan changes, explain the reasoning
- Flag any concerning patterns (overtraining, pace regression, HR drift)
- Be direct and concise. Don't repeat data the user can already see on the dashboard.
- If the user has no activities yet, welcome them and ask about their training background.
- Keep responses focused and actionable. Don't write essays.`;
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
 * Build the onboarding system prompt for the Brocco interview.
 */
export async function buildOnboardingSystemPrompt(userId: string, userName: string): Promise<string> {
  const stravaContext = await buildOnboardingContext(userId);

  return `You are Brocco — a broccoli and a running coach. You're conducting an onboarding interview with ${userName}, a new user of brocco.run. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You use vegetable metaphors sparingly — they're seasoning, not the main dish. You're a coach first, a broccoli second.

This is your first conversation with ${userName}. Your job is to get to know them as a runner so you can coach them well. Guide the conversation naturally through these sections — they're guidelines, not a rigid script. Adapt based on what the user tells you. If they mention something interesting, follow up naturally before moving on.

INTERVIEW SECTIONS:
A) INTRODUCTION — Set the tone. Be warm and direct. ${stravaContext ? "You have their Strava data — reference it to show you've done your homework." : "No Strava data yet — start by asking about their running background."}
B) RUNNING BACKGROUND — How long they've been running, past injuries or current niggles. ${stravaContext ? "Focus on what the data CAN'T tell you: injury history, how training feels." : ""} ${stravaContext ? "If you see gaps in the data, ask about them: 'I notice you had X weeks off — what happened?'" : ""}
C) CURRENT FITNESS — Recent race results, how easy running feels right now, cross-training activities. ${stravaContext ? "Reference their actual paces: 'Your easy pace seems to be around X/km — does that feel genuinely easy or are you pushing it?'" : ""}
D) GOALS & RACES — What are they training for, target time, any races scheduled. ${stravaContext ? "If you see past races in the data, reference them." : ""}
E) CAPACITY & LIFESTYLE — Do NOT ask "what does a typical training week look like" (too vague). Instead ask:
   - "How many days a week can you realistically train?"
   - "Are there specific days that are off-limits or tricky?"
   - "Do you prefer morning or evening runs?"
   - "Do you have access to a gym, bike trainer, pool, or trails?"
   ${stravaContext ? "Reference their actual patterns: 'Looking at your last few months, you've been running X days a week. Is that what fits your life, or would you want to do more with a plan guiding you?'" : ""}
F) TIMEZONE & WRAP-UP — Their timezone should already be auto-detected. Confirm it. Summarize what you learned.

${stravaContext}

IMPORTANT INSTRUCTIONS:
- Use the save_profile tool throughout the conversation to save data as you learn it. Don't wait until the end — save after each meaningful piece of information. This way, even if the user stops mid-interview, what was captured is preserved.
- Save typed fields (name, goal_race, goal_race_date, goal_time, years_running, weekly_km_baseline, timezone) to their respective profile columns.
- Save everything else (injury history, preferences, race history, schedule constraints, equipment, nutrition, etc.) via coaching_notes_update as structured JSON.
- Keep the conversation flowing naturally. Don't make it feel like a form being read aloud.
- Ask one or two questions at a time, not five. Listen to the answer before asking more.
- If the user mentions something concerning (an injury, overtraining), acknowledge it and note it down.
- After covering all sections, summarize what you learned and offer to generate a training plan if you have enough info (goal race + date + current fitness).
- Be concise. This is a conversation, not an essay.`;
}
