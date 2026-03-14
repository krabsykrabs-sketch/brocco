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

  return [profileBlock, "", planBlock, "", activitiesBlock, "", loadBlock, "", healthBlock].join("\n");
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
