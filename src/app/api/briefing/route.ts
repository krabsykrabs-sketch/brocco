import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  getAgenda,
  renderAgendaText,
  getUpcomingBirthdays,
  todayInTimezone,
  parseWall,
} from "@/lib/schedule";
import { resolveFeatures } from "@/lib/features";
import { format } from "date-fns";
import { COACH_MODEL } from "@/lib/models";
import { renderWeeklyGoalsLine } from "@/lib/weekly-goals";
import { generateNumberChecked } from "@/lib/number-guard";
import { weekTrainingFigures } from "@/lib/week-training";

const anthropic = new Anthropic();

/**
 * GET /api/briefing — Brocco's morning briefing for the Today screen.
 * Smart-trigger caching (same idea as the chat opener): regenerate only on a
 * new day or when a new activity has synced since the last generation.
 * ?refresh=1 forces regeneration.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const today = todayInTimezone(profile.timezone);
  const todayDate = parseWall(today);
  const force = new URL(request.url).searchParams.get("refresh") === "1";

  const [existing, latestActivity] = await Promise.all([
    prisma.dailyBriefing.findUnique({
      where: { userId_date: { userId, date: todayDate } },
    }),
    prisma.activity.findFirst({
      where: { userId },
      orderBy: { startDateLocal: "desc" },
      select: { id: true, name: true, activityType: true, distanceKm: true, avgPacePerKm: true },
    }),
  ]);

  if (existing && !force && existing.lastActivityId === (latestActivity?.id ?? null)) {
    return NextResponse.json({ briefing: existing.content, cached: true });
  }

  // --- Gather everything the briefing should know about ---
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

  const features = resolveFeatures(profile.features);

  const [agenda, birthdays, activePlan] = await Promise.all([
    getAgenda(userId, today, today, { includeOverdueTodos: true, today, includeRestWorkouts: true }),
    features.calendar ? getUpcomingBirthdays(userId, today, 7) : Promise.resolve([]),
    prisma.plan.findFirst({ where: { userId, status: "active" }, select: { name: true, raceDate: true } }),
  ]);

  // Disabled domains stay out of the briefing — a coach-only user gets a
  // pure training check-in
  if (!features.calendar) agenda.events = [];
  agenda.todos = [];

  // Same shared figures as the opener: one week definition, one running total,
  // with the timezone pad trimmed off exactly once.
  const { runKm: weekRunKm } = await weekTrainingFigures(userId, today);

  let dataBlock = `Today (${format(todayDate, "EEEE, MMMM d")}):\n${renderAgendaText(agenda)}\n`;
  dataBlock += `\nRunning this week so far: ${weekRunKm.toFixed(1)}km.`;
  if (activePlan) {
    dataBlock += ` Active plan: "${activePlan.name}"${activePlan.raceDate ? ` (race ${format(new Date(activePlan.raceDate), "MMM d")})` : ""}.`;
  }
  if (latestActivity) {
    dataBlock += `\nLatest synced activity: ${latestActivity.activityType} "${latestActivity.name}" ${latestActivity.distanceKm ? `${Number(latestActivity.distanceKm).toFixed(1)}km` : ""} ${latestActivity.avgPacePerKm || ""}.`;
  }
  if (birthdays.length > 0) {
    dataBlock += `\nUpcoming birthdays: ${birthdays.map((b) => `${b.title} ${b.daysUntil === 0 ? "TODAY" : `in ${b.daysUntil}d`}`).join(", ")}.`;
  }

  dataBlock += await renderWeeklyGoalsLine(userId, profile.timezone);

  let content: string;
  const systemPrompt = `You are Brocco, a broccoli who is ${user?.name || "the user"}'s running coach and life assistant. Write the morning briefing for the top of their Today screen: 2-3 short sentences summarizing the day — appointments, today's workout, due tasks — plus anything genuinely worth flagging (a conflict, an overdue item, a birthday coming up, yesterday's run worth a nod). Plain text, no markdown, no greeting, no status tags, no questions. Direct and specific; mention times. NUMBERS: quote only distances that appear in the data below, exactly as written — never calculate, sum or estimate one, and never add bike kilometres to running kilometres. If the day is empty, say so briefly and point at the week's training. Today is ${format(todayDate, "EEEE, MMMM d, yyyy")}.`;

  try {
    // Same distance check as the opener — this text is generated from a data
    // block and shown as fact, so an invented figure would read as one.
    const checked = await generateNumberChecked(dataBlock, [], "briefing", async (correction) => {
      const response = await anthropic.messages.create({
        model: COACH_MODEL,
        max_tokens: 220,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `${dataBlock}\n\nWrite the briefing.${correction ? `\n\n${correction}` : ""}`,
          },
        ],
      });
      return response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    });

    content = checked || fallbackBriefing(agenda.events.length, agenda.todos.length);
  } catch (err) {
    console.error("Briefing generation error:", err);
    content = fallbackBriefing(agenda.events.length, agenda.todos.length);
  }

  await prisma.dailyBriefing.upsert({
    where: { userId_date: { userId, date: todayDate } },
    create: { userId, date: todayDate, content, lastActivityId: latestActivity?.id ?? null },
    update: { content, lastActivityId: latestActivity?.id ?? null },
  });

  return NextResponse.json({ briefing: content, cached: false });
}

function fallbackBriefing(eventCount: number, taskCount: number): string {
  const parts: string[] = [];
  parts.push(eventCount > 0 ? `${eventCount} thing${eventCount === 1 ? "" : "s"} on the calendar today` : "Nothing on the calendar today");
  if (taskCount > 0) parts.push(`${taskCount} task${taskCount === 1 ? "" : "s"} due`);
  return parts.join(", ") + ".";
}
