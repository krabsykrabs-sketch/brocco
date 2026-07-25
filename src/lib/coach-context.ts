import { prisma } from "@/lib/db";
import { subDays, subWeeks, startOfWeek, endOfWeek, format, addDays } from "date-fns";
import {
  getAgenda,
  renderAgendaText,
  getUpcomingBirthdays,
  todayInTimezone,
  nowInTimezone,
  parseWall,
  wallDateString,
  formatDateShort,
  addDaysWall,
} from "@/lib/schedule";
import { groupActivitiesByDay, workoutOutcome, activityDayKey } from "@/lib/plan-progress";
import { getPaceCurve, formatTimeSec, formatPaceSec } from "@/lib/run-trends";
import type { StravaLap } from "@/lib/strava";
import type { ActivityAnalysis } from "@/lib/heart-rate-analysis";
import { resolveFeatures, anyLifeFeature, type Features } from "@/lib/features";

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
        source: true,
        distanceKm: true,
        durationMin: true,
        movingTimeMin: true,
        avgPacePerKm: true,
        avgHeartRate: true,
        elevationGainM: true,
        perceivedEffort: true,
        startDateLocal: true,
        activityAnalysis: true,
        laps: true,
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
  // Strava state is part of the profile: without it Brocco can't tell a
  // brand-new user (no history to learn from — ask them to connect) from
  // someone who genuinely hasn't run lately.
  const stravaConnected = !!profile.stravaAccessToken;
  const profileBlock = [
    `PROFILE:`,
    `- Name: ${userName}`,
    profile.goalRace ? `- Goal: ${profile.goalRace}${profile.goalTime ? `, ${profile.goalTime}` : ""}` : `- Goal: General fitness`,
    profile.goalRaceDate ? `- Race date: ${format(new Date(profile.goalRaceDate), "MMM d, yyyy")}` : null,
    profile.yearsRunning != null ? `- Running experience: ${profile.yearsRunning} years` : null,
    profile.weeklyKmBaseline ? `- Baseline: ~${Number(profile.weeklyKmBaseline)} km/week` : null,
    `- Timezone: ${profile.timezone}`,
    stravaConnected
      ? `- Strava: connected (their recorded history is below — trust it)`
      : `- Strava: NOT CONNECTED — no training history available. See STRAVA FIRST below.`,
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

  // --- Current plan (this week reconciled + next 2 weeks) ---
  const planBlock = await buildPlanContext(userId, profile.timezone);

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
        const lapNote = formatLapAnnotation(a.laps);
        const src = a.source === "strava" ? "strava" : "logged in app";
        return `- ${date}: ${a.activityType} "${a.name}" — ${parts} (${src})${intensity}${lapNote}`;
      })
      .join("\n");
    activitiesBlock +=
      "\n(This list includes EVERY recorded workout regardless of source — Strava, logged via chat, or done with the in-app workout player. Trust it.)";
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

  // --- Life planner: schedule + birthdays (next 7 days) ---
  // Respects the user's feature toggles — with everything off, Brocco's
  // context is the classic coach package.
  const features = resolveFeatures(profile.features);
  const blocks = [profileBlock];
  if (coachingNotesBlock) blocks.push(coachingNotesBlock);
  blocks.push(planBlock, activitiesBlock, loadBlock, healthBlock);
  if (features.calendar) {
    blocks.push(await buildLifeContext(userId, profile.timezone, features));
  }
  return blocks.join("\n\n");
}

/**
 * Schedule context: today + next 7 days of events, plus upcoming
 * birthdays. Workouts are omitted here; they're already in the plan block.
 */
async function buildLifeContext(userId: string, timezone: string, features: Features): Promise<string> {
  const today = todayInTimezone(timezone);
  const weekOut = wallDateString(addDaysWall(parseWall(today), 7));

  const [agenda, birthdays] = await Promise.all([
    getAgenda(userId, today, weekOut, { today }),
    features.calendar ? getUpcomingBirthdays(userId, today, 14) : Promise.resolve([]),
  ]);

  // Drop workouts (plan block covers them) and any disabled domains
  const scheduleText = renderAgendaText({
    ...agenda,
    workouts: [],
    events: features.calendar ? agenda.events : [],
    todos: [],
  });

  let block = `SCHEDULE (today ${today} through ${weekOut}, times are the user's local time):\n`;
  block += scheduleText;

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

/**
 * Watch-recorded lap paces, appended when a run has real lap structure
 * (3-14 laps — more means km auto-laps, which the splits already cover).
 * This is the ground truth for interval execution: with a synced structured
 * workout, each step is one lap.
 */
function formatLapAnnotation(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 14) return "";
  const laps = raw as StravaLap[];
  const rendered = laps
    .map((l) => {
      if (!l.paceSecPerKm) return null;
      const m = Math.floor(l.paceSecPerKm / 60);
      const s = l.paceSecPerKm % 60;
      const dist = l.distanceM >= 1000 ? `${(l.distanceM / 1000).toFixed(1)}k` : `${l.distanceM}m`;
      return `${dist}@${m}:${String(s).padStart(2, "0")}`;
    })
    .filter(Boolean);
  if (rendered.length < 3) return "";
  return ` [laps: ${rendered.join(", ")}]`;
}

async function buildPlanContext(userId: string, timezone: string): Promise<string> {
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

  const todayStr = todayInTimezone(timezone);
  let currentWeekNum: number | null = null;
  let currentWeekStart: string | null = null;
  let currentWeekEnd: string | null = null;
  let currentPhaseName: string | null = null;
  let currentWeekTargetKm: number | null = null;
  let currentWeekTargetSessions: number | null = null;
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
        currentWeekTargetKm = pw.targetKm != null ? Number(pw.targetKm) : null;
        currentWeekTargetSessions = pw.targetSessions ?? null;
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
    // The week's target_km is the AUTHORITATIVE planned running volume — use
    // it, never sum the workout list below (some runs carry no distance, so
    // summing under-counts and makes actual mileage look over target).
    const targetStr =
      currentWeekTargetKm != null
        ? ` Weekly running target: ${currentWeekTargetKm}km${currentWeekTargetSessions ? ` across ${currentWeekTargetSessions} sessions` : ""} (this is the planned volume — do NOT add up the per-workout distances below, some are time-based).`
        : "";
    block += `CURRENT WEEK: Week ${currentWeekNum} of ${totalWeeks} (${currentWeekStart}-${currentWeekEnd}).${phaseStr} ${completedWeeks} week${completedWeeks !== 1 ? "s" : ""} completed.${targetStr}\n\n`;
  }

  // This week (from Monday, INCLUDING days already past) + next week, so the
  // model sees planned vs. actually-done — not just what's still ahead. The
  // old `date >= now` query silently dropped TODAY's workout all day long
  // (workout dates are stored at midnight).
  const todayWall = parseWall(todayStr);
  const dow = todayWall.getUTCDay() === 0 ? 7 : todayWall.getUTCDay();
  const weekStart = addDaysWall(todayWall, -(dow - 1));
  const rangeEnd = addDaysWall(weekStart, 13);

  const [workouts, weekActivities] = await Promise.all([
    prisma.plannedWorkout.findMany({
      where: { planId: plan.id, date: { gte: weekStart, lte: rangeEnd } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        title: true,
        workoutType: true,
        activityType: true,
        targetDistanceKm: true,
        targetPace: true,
        targetDurationMin: true,
        status: true,
      },
    }),
    prisma.activity.findMany({
      where: {
        userId,
        // 1-day pad absorbs timezone offsets around the week boundary
        startDateLocal: { gte: new Date(weekStart.getTime() - 86400000) },
      },
      select: {
        name: true,
        activityType: true,
        distanceKm: true,
        durationMin: true,
        avgPacePerKm: true,
        startDateLocal: true,
        source: true,
      },
    }),
  ]);

  const byDay = groupActivitiesByDay(weekActivities);
  const matchedActs = new Set<(typeof weekActivities)[number]>();

  const renderTargets = (w: (typeof workouts)[number]) =>
    [
      w.targetDistanceKm ? `${Number(w.targetDistanceKm)}km` : "",
      w.targetPace || "",
      w.targetDurationMin ? `${w.targetDurationMin}min` : "",
    ]
      .filter(Boolean)
      .join(", ");

  const renderLine = (w: (typeof workouts)[number]) => {
    const dateStr = wallDateString(w.date);
    const { outcome, matched } = workoutOutcome(
      { dateStr, activityType: w.activityType, workoutType: w.workoutType, status: w.status },
      byDay,
      todayStr
    );
    if (matched) matchedActs.add(matched);
    let ann: string;
    switch (outcome) {
      case "done": {
        if (matched) {
          const dist = matched.distanceKm ? `${Number(matched.distanceKm).toFixed(1)}km` : "";
          const dur = matched.durationMin ? `${Math.round(Number(matched.durationMin))}min` : "";
          const pace = matched.avgPacePerKm || "";
          const det = [dist, dur, pace].filter(Boolean).join(", ");
          ann = `✓ DONE — "${matched.name}"${det ? ` (${det})` : ""}`;
        } else {
          ann = "✓ DONE (marked completed)";
        }
        break;
      }
      case "missed":
        ann = "✗ NOT DONE";
        break;
      case "skipped":
        ann = "skipped";
        break;
      case "today_pending":
        ann = "TODAY — not done yet (check the current time before commenting; earlier in the day this is expected, not missed)";
        break;
      case "rest":
        ann = "rest day";
        break;
      default:
        ann = "upcoming";
    }
    return `- ${formatDateShort(dateStr)}: ${w.workoutType} "${w.title}"${renderTargets(w) ? ` — ${renderTargets(w)}` : ""} [${ann}] (id: ${w.id})`;
  };

  const thisWeek = workouts.filter((w) => wallDateString(w.date) <= wallDateString(addDaysWall(weekStart, 6)));
  const nextWeek = workouts.filter((w) => wallDateString(w.date) > wallDateString(addDaysWall(weekStart, 6)));

  block += `THIS WEEK (${formatDateShort(wallDateString(weekStart))} – ${formatDateShort(wallDateString(addDaysWall(weekStart, 6)))}) — planned vs. actual:\n`;
  block += thisWeek.length > 0 ? thisWeek.map(renderLine).join("\n") : "No workouts planned this week.";

  // Activities this week that don't correspond to any planned workout —
  // spontaneous runs, extra rides, ad-hoc strength sessions
  const extras = weekActivities.filter(
    (a) => !matchedActs.has(a) && activityDayKey(a.startDateLocal) >= wallDateString(weekStart)
  );
  if (extras.length > 0) {
    block += "\nExtra (unplanned) activities this week:\n";
    block += extras
      .map((a) => {
        const dist = a.distanceKm ? `${Number(a.distanceKm).toFixed(1)}km` : "";
        const dur = a.durationMin ? `${Math.round(Number(a.durationMin))}min` : "";
        return `- ${format(new Date(a.startDateLocal), "MMM d (EEE)")}: ${a.activityType} "${a.name}" — ${[dist, dur, a.avgPacePerKm].filter(Boolean).join(", ")}`;
      })
      .join("\n");
  }

  block += "\n\nNext week:\n";
  block += nextWeek.length > 0 ? nextWeek.map(renderLine).join("\n") : "No workouts scheduled yet.";
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
      movingTimeMin: true,
      durationMin: true,
      activityAnalysis: true,
    },
  });

  let block = "TRAINING LOAD (last 8 weeks, running km, and % of analyzed time in Z4-5):\n";
  const rows: string[] = [];

  for (let i = 7; i >= 0; i--) {
    const ws = subWeeks(weekStart, i);
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const label = format(ws, "MMM d");
    const weekActs = activities.filter((a) => {
      const d = new Date(a.startDateLocal);
      return d >= ws && d <= we;
    });
    const km = weekActs.reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

    // Intensity distribution — duration-weighted Z4+Z5 share across the
    // week's analyzed runs (the 80/20 polarization check)
    let analyzedMin = 0;
    let hardMin = 0;
    for (const a of weekActs) {
      const zones = (a.activityAnalysis as ActivityAnalysis | null)?.zones;
      if (!zones) continue;
      const min = Number(a.movingTimeMin ?? a.durationMin);
      analyzedMin += min;
      hardMin += (min * (zones.z4Pct + zones.z5Pct)) / 100;
    }
    const hard = analyzedMin > 0 ? ` (${Math.round((hardMin / analyzedMin) * 100)}% hard)` : "";
    rows.push(`${label}: ${km.toFixed(1)} km${hard}`);
  }

  block += rows.join(" | ");

  // Rolling best efforts — fitness signal without racing
  const paceCurve = await getPaceCurve(userId, 90);
  if (paceCurve.length > 0) {
    block += "\nBEST EFFORTS (fastest rolling splits, last 90 days): ";
    block += paceCurve
      .map((e) => {
        const trend =
          e.prevBestTimeSec != null
            ? e.bestTimeSec < e.prevBestTimeSec
              ? ` (↑ ${formatTimeSec(e.prevBestTimeSec - e.bestTimeSec)} faster than prior 90d)`
              : ` (${formatTimeSec(e.bestTimeSec - e.prevBestTimeSec)} slower than prior 90d)`
            : "";
        return `${e.label} ${formatTimeSec(e.bestTimeSec)} @${formatPaceSec(e.paceSecPerKm)}${trend}`;
      })
      .join(" · ");
  }
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
  mode: "chat" | "capture" | "kitchen" = "chat"
): Promise<string> {
  // Check coaching notes to determine if background gathering is needed
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const coachingNotes = profile?.coachingNotes as Record<string, unknown> | null;
  const hasCoachingNotes = coachingNotes && Object.keys(coachingNotes).length > 0;
  const stravaConnected = !!profile?.stravaAccessToken;

  // Without Strava there is no training history, so every fitness judgement
  // would be guesswork. Getting it connected is the highest-value first move
  // with a new runner — more than any interview question.
  const stravaFirst = stravaConnected
    ? ""
    : `
STRAVA FIRST — the runner has NOT connected Strava:
This is your top priority in the conversation, ahead of building anything. Their Strava history is where you learn their real mileage, paces, consistency and injury-free load — without it you are guessing, and any plan you build is generic.
- Open your FIRST message to a new runner by introducing yourself briefly and asking them to connect Strava, saying plainly what it buys them ("I'll read your last months of running and build the plan around what you actually do, instead of asking you twenty questions"). Point them to Settings → Connect Strava, or the "Connect Strava" button on the Today screen.
- If they ask for a training plan while Strava is disconnected, ask to connect it BEFORE the interview: "Connect Strava first and I can skip most of the questions — want to do that now, or shall we build it from what you tell me?"
- If they decline or say they don't use Strava, accept it immediately and move on without nagging — run the interview from their answers instead, and ask a few extra questions about recent weekly volume, longest recent run and current paces to compensate. Ask at most once more, much later, and only if it would visibly help.
- Never claim they haven't been training when Strava is disconnected — you simply have no data.
`;

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
    life.kitchen && "kitchen & recipes",
    life.calendar && "important dates",
  ].filter(Boolean).join(", ");

  const identityLine = isLife
    ? `You are Brocco — a broccoli, ${userName}'s personal running coach, and the assistant who runs their day-to-day life: ${lifeDomains}. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish, and you keep them out of plain life admin (confirming a dentist appointment needs no broccoli joke). You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You're a coach first, a broccoli second, and always one single assistant — the user never has to pick a "mode".`
    : `You are Brocco — a broccoli and ${userName}'s personal running coach. You have deep exercise physiology knowledge and an aggressively healthy outlook on life. You're data-driven and direct. You use vegetable and garden metaphors sparingly — they're seasoning, not the main dish. You're inexplicably competitive for a vegetable. You treat recovery with the reverence of good soil and sunlight. Your advice is genuinely excellent and specific. You take their training seriously even though you're a broccoli. Keep it fun without sacrificing accuracy. You're a coach first, a broccoli second.`;

  const accessLine = `You have access to their training data from Strava and their training plan${
    [life.calendar && "their calendar", life.kitchen && "their recipe library"]
      .filter(Boolean).map((s) => `, ${s}`).join("")
  }.`;

  const routingLines = [
    life.calendar && "- Appointments, meetings, social plans, travel, anything with a date AND a time/place → manage_event",
    life.calendar && "- Birthdays and yearly dates → manage_event (category birthday, all-day, yearly recurrence)",
    "- Runs and training sessions → the training plan tools (adjust_plan/modify_plan), NEVER calendar events",
    '- "Make me a workout" / "something for my core" → create_workout (a playable guided session with timer + voice cues), not a note or task',
    life.kitchen && '- "What can I cook?" / "I have zucchini, eggs, feta" → manage_recipe search FIRST (prefer their saved recipes), then suggest. A vegetable helping with dinner is your moment — but keep suggestions practical and match them to training (carbs before long runs, protein after strength).',
    life.kitchen && '- "Save that recipe" / user dictates a recipe → manage_recipe save. Recipes stay in their original language.',
    life.calendar && '- "What does my Thursday look like?" / free-slot questions → query_schedule first, then answer',
    '- Resolve relative dates ("Thursday", "tomorrow", "next week") against today\'s date above. If "Thursday" is ambiguous between tomorrow and next week, ask — one short question.',
  ].filter(Boolean).join("\n");

  const routingBlock = isLife
    ? `\nROUTING — pick the right tool without making the user name the feature:\n${routingLines}\n`
    : "";

  const pantryStaples =
    life.kitchen && Array.isArray(profile?.pantryStaples)
      ? (profile!.pantryStaples as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
  const staplesBlock =
    pantryStaples.length > 0
      ? `\nPANTRY STAPLES (the user ALWAYS has these in stock — assume they're available in every recipe suggestion without being listed): ${pantryStaples.join(", ")}. Manage the list with manage_recipe actions staples_add / staples_remove when the user mentions changes ("I always have harissa now", "we're done with chickpeas").\n`
      : life.kitchen
      ? `\n(No pantry staples saved yet. If the user mentions ingredients they always keep in stock, offer to save them with manage_recipe staples_add.)\n`
      : "";

  const crossDomainBlock = life.calendar
    ? `\nCROSS-DOMAIN AWARENESS (your signature move):
You see training AND life in one place — use it. Before adding events, and when the plan changes, check the schedule (context above, or query_schedule for other dates) and flag collisions: "Your long run is Saturday morning but you've got a 7am flight — want me to move the run to Friday?" Mention conflicts proactively; offer a concrete fix; let the user decide. Same for fatigue-vs-life logic: a packed work week or late social events around hard sessions are worth a comment.\n`
    : "";

  const tz = profile?.timezone || "Europe/Berlin";
  const nowWall = nowInTimezone(tz);
  const identity = `${identityLine}

Today's date is ${todayString(profile?.timezone)} and the CURRENT TIME is ${nowWall.slice(11, 16)}. All times are the user's local time (${tz}).
Factor the time of day into everything: at 7am, today's workout simply hasn't happened yet — that's normal, not a missed session. A planned workout only counts as missed once its day is over. Never claim the user hasn't trained without checking the reconciled plan (✓/✗ annotations) and recent-training list below — they include workouts from ALL sources (Strava, chat-logged, in-app workout player).

${accessLine}

${context}
${routingBlock}${staplesBlock}${crossDomainBlock}
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
${stravaFirst}
PLAN CREATION:
When the runner asks you to create a training plan, conduct a structured interview:
${planWarning}
1) GOAL TYPE — Ask what they want to achieve:
   - Race-specific: Which race, when, goal time? You'll build a periodized plan (base → build → peak → taper).
   - General fitness: No race. Ask what they want: build mileage, get faster, maintain fitness, come back from injury. You'll build progressive blocks with benchmark workouts.
   - Hybrid / Hyrox (or other hybrid race like a marathon+Hyrox block): a periodized plan that balances RUNNING volume with FUNCTIONAL / gym sessions. Ask the race date and how many gym days per week they want. You manage the running (volume, quality sessions, long runs, compromised-running work where relevant) and SCHEDULE their functional sessions — you do NOT prescribe the exercises. The athlete runs their own Hyrox/strength session in the gym; your job is the days, the load balance, and the taper. See HYBRID / HYROX PLANS below.
   - If they're unsure, suggest goals based on their data and fitness level.

2) CURRENT FITNESS — Reference their Strava data and coaching notes. Acknowledge honestly where they're starting from. If Strava is NOT connected, ask them to connect it here before going further (see STRAVA FIRST) — it replaces most of this step. If they'd rather not, ask instead: recent weekly volume, longest run in the last month, and a rough easy/threshold pace.

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
   b) **plan_weeks**: Metadata for EVERY week. Each week: week_number, start_date, detail_level, target_km, target_sessions, session_types.
      - WEEK BOUNDARIES ARE MONDAY–SUNDAY (matching the calendar). Every week's start_date is a Monday.
      - If the plan starts ON a Monday: begin at week_number 1, no partial week.
      - If the plan starts MID-WEEK (any other weekday): create a partial lead-in week_number 0 whose start_date is the actual start day and which runs through that Sunday, then week_number 1 begins the FOLLOWING Monday. Number the rest 2, 3, … from there. Week 0 is a normal (usually lighter) training week, just short.
      - Weeks 1-2: detail_level = "detailed"
      - Weeks 3-4: detail_level = "outline"
      - Weeks 5+: detail_level = "target"
      - (Week 0, if present, is "detailed".)
   c) **workouts**: Individual workouts ONLY for weeks 1-4:
      - Weeks 1-2 (detailed): Full specs — date, title, workout_type, target_distance_km, target_pace, description
      - Weeks 3-4 (outline): Just date, title, workout_type, approximate target_distance_km
      - Do NOT generate workouts for week 5+
      - For interval/tempo/race_pace workouts in detailed weeks, ALSO fill the structured "steps" array (warmup / repeat(work, recovery) / cooldown with paces) — these guide the user's watch through each rep. Plain easy/long runs don't need steps.
   Explain to the runner: "I've planned your first two weeks in detail and outlined weeks 3-4. As each new week starts, I'll fill in the details based on how your training is going."

7) REVIEW — Present a summary showing the phase structure and first 2 weeks of workouts. Ask "Does this look good? Should I create it?" Wait for confirmation before calling generate_plan. The tool applies the plan immediately.

Flag any unanswered questions with proposed defaults before generating the plan. For example: "I notice you didn't mention X, Y, and Z. Should I go with these assumptions: [list]?" Never proceed to plan generation with unconfirmed assumptions.

STRENGTH & CONDITIONING — every plan includes it:
Unless the runner declines, weave 1-2 short S&C sessions per week into the plan as workouts (workout_type "strength", activity_type "strength", target_duration_min 15-25, title like "S&C: Core & Hips"). Place them on easy or rest days, never before hard sessions. Rotate focus across the block: core/trunk, hips & glutes, calves & ankles, full body — biased toward the runner's injury history. Each strength workout in the plan gets a tap-to-start guided timer session automatically, so keep descriptions short ("core + hip stability circuit") rather than listing exercises.

After the plan is created, use add_weekly_tasks to add supplementary tasks (mobility, nutrition, recovery) to relevant weeks — not strength, which now lives in the plan itself.

ONE WORKOUT = ONE SPORT, ONE SESSION (critical for watch sync):
Every workout entry — in generate_plan and in every modify_plan/adjust_plan "add" — is a single continuous session of a single sport. NEVER combine sports or sessions in one workout. A brick ("5km run + 60min Z2 ride"), a double day ("AM easy run, PM intervals"), or "swim then run" must be created as SEPARATE workout entries on the SAME date, each with its own activity_type (run/cycle/swim/…), its own title ("Easy Run 5km", "Z2 Ride 60min"), and its own targets/steps. A title must never contain a "+", "then", "&", or two distances/sports. This is what lets each workout export cleanly to the user's COROS/Garmin watch via intervals.icu, which reads exactly one sport per workout — a combined entry either syncs wrong or not at all. If the runner asks for a combined session, split it silently into the right number of single-sport workouts.

EVERY WORKOUT NEEDS A MEASURABLE TARGET (no bare "Easy Run"):
Never create a non-rest workout without something to measure it by. Runs are measured in KILOMETRES — always set target_distance_km (a plain easy run still gets one, e.g. 6km). Cycling and other secondary sports in a running plan are measured in MINUTES — set target_duration_min, not distance (e.g. a Z2 ride is target_duration_min 60, no km). A run with no distance breaks the weekly volume maths (it silently counts as 0km and makes the runner look over target) and gives the watch nothing to guide by, so it is never acceptable. Weekly running volume is tracked in km from runs only; rides are tracked as completed/not-completed sessions by their minutes, and never fold into the km total.

HYBRID / HYROX PLANS:
For Hyrox or other hybrid goals, you plan the running and SCHEDULE the functional work — you do not write the gym session. Represent each functional/Hyrox gym day as its own workout with activity_type "other", workout_type "cross_training", a target_duration_min (e.g. 60), and a clear title ("Hyrox session", "Functional strength (gym)", "Compromised-running + stations — your gym"). Do NOT add a steps array and do NOT list exercises — the athlete runs their own session; leave the description to a one-line intent at most ("station strength + short runs"). These days are separate workouts from any run (one sport per workout), never sync to the watch (that's correct — they're gym work), and count as completed/not-completed sessions for the week. Your coaching value is the STRUCTURE: how many run vs gym days, running volume and quality around the gym load, protecting key runs from gym fatigue, and tapering both into the race. Know the Hyrox format (8×1km runs alternating with 8 functional stations) well enough to periodize sensibly, but keep prescription to running only.

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
  life.kitchen && "- manage_recipe: search/get/save/delete recipes in their kitchen library; log when they cooked one",
  life.calendar && "- query_schedule: read calendar + workouts for any date range",
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
- If it's a question ("when's my next long run?", "what's tomorrow looking like?"), use the tools to find the answer and reply with the answer in 1-2 short sentences.
- A SCREEN CONTEXT block in the user message tells you what they're looking at. "Move that to 5pm" while viewing a specific event means THAT event. Captures from the calendar default to that visible week.
- NO status lines, NO greetings, NO follow-up questions, NO vegetable metaphors in capture mode.` : ""}${mode === "kitchen" ? `

KITCHEN CHAT MODE:
This conversation happens in the Kitchen tab — a dedicated cooking chat, separate from coaching. The user comes here to figure out what to cook.
- The core flow: they describe what they have ("fridge: zucchini, eggs, half a feta") → search their recipe library FIRST (manage_recipe search, staples count as available), then offer 2-3 concrete suggestions — a one-line pitch each, not full recipes — and let them pick. Only after they choose do you give the full ingredients + steps (from the library via 'get', or from your own knowledge).
- When they cooked something, log it ('cooked'). When they like a suggestion of yours, offer to save it to the library.
- Stay training-aware in your suggestions (carbs before tomorrow's long run, protein after strength) — the context block tells you what's coming up. But keep the conversation about food: for actual coaching questions, point them to the coach chat.
- Groceries, portions, substitutions, technique questions — all fair game.
- Status lines still apply. Vegetable enthusiasm is permitted at slightly elevated levels; you are, after all, an ingredient.` : ""}`;
}

