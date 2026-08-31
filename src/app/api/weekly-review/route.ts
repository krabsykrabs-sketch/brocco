import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  getAgenda,
  renderAgendaText,
  todayInTimezone,
  nowInTimezone,
  parseWall,
  wallDateString,
  addDaysWall,
} from "@/lib/schedule";
import { isCompatibleType, RUN_TYPES } from "@/lib/activity-types";
import { resolveFeatures } from "@/lib/features";
import type { ActivityAnalysis } from "@/lib/heart-rate-analysis";
import { format } from "date-fns";
import { COACH_MODEL } from "@/lib/models";
import { rateLimit } from "@/lib/rate-limit";
import { generateNumberChecked } from "@/lib/number-guard";

const anthropic = new Anthropic();

/** Monday of the week containing the given "yyyy-MM-dd", UTC-anchored. */
function mondayOf(dateStr: string): Date {
  const d = parseWall(dateStr);
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return addDaysWall(d, -(dow - 1));
}

/**
 * GET /api/weekly-review — Brocco's week recap + next-week preview.
 *
 * Display window: Sunday from 17:00 (reviewing the week that's ending)
 * through the whole of Monday (reviewing the week that just ended). Outside
 * the window returns {available:false}. Generated lazily on first request
 * in the window, cached per (user, week). ?force=1 bypasses the window and
 * reviews the current week-to-date (useful for testing and the curious).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const force = new URL(request.url).searchParams.get("force") === "1";
  // force bypasses both the window AND the cache read — an Opus call on
  // every hit. Cap it.
  if (force && !rateLimit(`weekly-review-force:${userId}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many forced reviews." }, { status: 429 });
  }
  const localNow = nowInTimezone(profile.timezone); // yyyy-MM-ddTHH:mm
  const today = localNow.slice(0, 10);
  const dow = parseWall(today).getUTCDay(); // 0=Sun .. 6=Sat
  const hour = Number(localNow.slice(11, 13));

  let reviewWeekStart: Date | null = null;
  if (dow === 0 && hour >= 17) {
    reviewWeekStart = mondayOf(today); // Sunday evening: the week now ending
  } else if (dow === 1) {
    reviewWeekStart = addDaysWall(mondayOf(today), -7); // Monday: last week
  } else if (force) {
    reviewWeekStart = mondayOf(today); // testing: current week so far
  }

  if (!reviewWeekStart) {
    return NextResponse.json({ available: false });
  }

  const weekStartStr = wallDateString(reviewWeekStart);
  const weekEndStr = wallDateString(addDaysWall(reviewWeekStart, 6));

  // Cached?
  const existing = await prisma.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart: reviewWeekStart } },
  });
  if (existing && !force) {
    return NextResponse.json({ available: true, review: existing.content, weekStart: weekStartStr });
  }

  // --- Assemble the week's story ---
  const features = resolveFeatures(profile.features);
  const weekStartDt = reviewWeekStart;
  const weekEndDt = parseWall(`${weekEndStr}T23:59`);

  const prevWeekStartStr = wallDateString(addDaysWall(reviewWeekStart, -7));
  const [activities, planned, agendaNext] = await Promise.all([
    prisma.activity.findMany({
      where: { userId, startDateLocal: { gte: weekStartDt, lte: weekEndDt } },
      orderBy: { startDateLocal: "asc" },
      select: {
        name: true, activityType: true, distanceKm: true, avgPacePerKm: true,
        avgHeartRate: true, startDateLocal: true, activityAnalysis: true,
      },
    }),
    prisma.plannedWorkout.findMany({
      where: { plan: { userId, status: "active" }, date: { gte: weekStartDt, lte: weekEndDt } },
      orderBy: { date: "asc" },
    }),
    // Next week's preview: workouts + (if enabled) events and due tasks
    getAgenda(userId, wallDateString(addDaysWall(reviewWeekStart, 7)), wallDateString(addDaysWall(reviewWeekStart, 13)), {
      includeOverdueTodos: false,
    }),
  ]);
  if (!features.calendar) agendaNext.events = [];
  agendaNext.todos = [];

  // Recap numbers
  const runs = activities.filter((a) => RUN_TYPES.includes(a.activityType));
  const runKm = runs.reduce((s, a) => s + (a.distanceKm ? Number(a.distanceKm) : 0), 0);
  const nonRest = planned.filter((w) => w.workoutType !== "rest");
  const plannedKm = nonRest.reduce((s, w) => s + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

  let completed = 0;
  const missed: string[] = [];
  for (const w of nonRest) {
    const wDate = wallDateString(w.date);
    const dayActs = activities.filter((a) => format(new Date(a.startDateLocal), "yyyy-MM-dd") === wDate);
    if (dayActs.some((a) => isCompatibleType(w.activityType, a.activityType))) completed++;
    else if (wDate <= today) missed.push(`${w.title} (${format(new Date(w.date), "EEE")})`);
  }

  // Intensity flags from HR analysis
  const intensityNotes: string[] = [];
  for (const a of activities) {
    const an = a.activityAnalysis as unknown as ActivityAnalysis | null;
    if (!an) continue;
    if (an.effortVsPlanned === "harder_than_planned") intensityNotes.push(`${a.name}: ran harder than planned`);
    if (an.effortVsPlanned === "easier_than_planned") intensityNotes.push(`${a.name}: ran easier than planned`);
    if (an.decouplingPct != null && an.decouplingPct >= 8) intensityNotes.push(`${a.name}: high cardiac drift (+${an.decouplingPct}%)`);
  }

  // Best run (longest)
  const longest = runs.reduce<(typeof runs)[number] | null>(
    (best, a) => (!best || Number(a.distanceKm || 0) > Number(best.distanceKm || 0) ? a : best),
    null
  );

  let dataBlock = `WEEK REVIEWED: ${weekStartStr} to ${weekEndStr}${force && dow !== 0 && dow !== 1 ? " (week still in progress)" : ""}\n`;
  dataBlock += `Running: ${runKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned; sessions completed ${completed}/${nonRest.length}.\n`;
  if (missed.length) dataBlock += `Missed: ${missed.join(", ")}.\n`;
  if (longest && Number(longest.distanceKm || 0) > 0) {
    dataBlock += `Longest run: "${longest.name}" ${Number(longest.distanceKm).toFixed(1)}km${longest.avgPacePerKm ? ` @ ${longest.avgPacePerKm}` : ""}.\n`;
  }
  if (intensityNotes.length) dataBlock += `Intensity flags: ${intensityNotes.join("; ")}.\n`;
  dataBlock += `\nNEXT WEEK:\n${renderAgendaText(agendaNext)}`;

  let content: string | null = null;
  try {
    // Same distance check as the briefing and the opener — this is the most
    // number-dense of the three generators and was the only one unguarded.
    content = await generateNumberChecked(dataBlock, [], "weekly-review", async (correction) => {
      const response = await anthropic.messages.create({
        model: COACH_MODEL,
        max_tokens: 400,
        system: `You are Brocco, a broccoli running coach and life assistant, writing the weekly review shown on the Today screen. 4-6 short sentences, two parts: (1) the week that was — headline numbers, one genuine highlight, one honest observation (missed sessions, intensity discipline) without nagging; (2) next week — the key session, any calendar collisions with training worth flagging, and one concrete focus. Quote only figures that appear in the data — never calculate or estimate distances. Plain text, no markdown, no greeting, no questions. Direct, warm, specific. A single vegetable flourish is allowed if it earns its place.`,
        messages: [
          {
            role: "user",
            content: `${dataBlock}\n\nWrite the weekly review.${correction ? `\n\n${correction}` : ""}`,
          },
        ],
      });
      return response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    });
  } catch (err) {
    console.error("Weekly review generation error:", err);
  }
  if (!content) {
    content = `Week done: ${runKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned, ${completed}/${nonRest.length} sessions completed.`;
  }

  await prisma.weeklyReview.upsert({
    where: { userId_weekStart: { userId, weekStart: reviewWeekStart } },
    create: { userId, weekStart: reviewWeekStart, content },
    update: { content },
  });

  return NextResponse.json({ available: true, review: content, weekStart: weekStartStr });
}
