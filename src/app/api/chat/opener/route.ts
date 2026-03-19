import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { format, startOfWeek, endOfWeek } from "date-fns";

const anthropic = new Anthropic();

/**
 * POST /api/chat/opener
 * Generate a contextual, data-driven opening message for Brocco.
 *
 * Smart triggers: only generates a new opener if:
 * 1. New day since last opener, OR
 * 2. New activity since last opener
 *
 * Body: { sessionId, trigger?: "new_day" | "new_activity" | "new_session" }
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId, trigger } = await request.json();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: { type: true },
  });
  if (!chatSession || chatSession.type !== "general") {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const userId = session.userId;
  const now = new Date();
  const todayStr = format(now, "yyyy-MM-dd");
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  // Gather comprehensive week data for analysis
  const [user, profile, activePlan, weekActivities, weekPlanned, latestActivity] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.plan.findFirst({
        where: { userId, status: "active" },
        select: { name: true, raceDate: true },
      }),
      prisma.activity.findMany({
        where: { userId, startDateLocal: { gte: weekStart, lte: weekEnd } },
        orderBy: { startDateLocal: "desc" },
        select: {
          id: true, name: true, activityType: true, distanceKm: true,
          avgPacePerKm: true, avgHeartRate: true, startDateLocal: true,
        },
      }),
      prisma.plannedWorkout.findMany({
        where: { plan: { userId, status: "active" }, date: { gte: weekStart, lte: weekEnd } },
        orderBy: { date: "asc" },
        select: {
          title: true, workoutType: true, activityType: true,
          targetDistanceKm: true, targetPace: true, date: true,
        },
      }),
      prisma.activity.findFirst({
        where: { userId },
        orderBy: { startDateLocal: "desc" },
        select: { id: true, name: true, activityType: true, distanceKm: true, avgPacePerKm: true, startDateLocal: true },
      }),
    ]);

  const userName = user?.name || "Runner";

  // Build a data summary for the AI
  const runTypes = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
  const weekRunKm = weekActivities
    .filter((a) => runTypes.includes(a.activityType))
    .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

  const plannedKm = weekPlanned
    .filter((w) => w.workoutType !== "rest")
    .reduce((sum, w) => sum + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

  // Day-by-day summary for the current week
  const daySummaries: string[] = [];
  const pastMissed: string[] = [];
  for (const pw of weekPlanned) {
    const pwDate = format(new Date(pw.date), "yyyy-MM-dd");
    const isPast = pwDate < todayStr;
    const isToday = pwDate === todayStr;
    const dayActs = weekActivities.filter((a) => format(new Date(a.startDateLocal), "yyyy-MM-dd") === pwDate);

    if (pw.workoutType === "rest") continue;

    const hasCompatible = dayActs.some((a) => {
      const typeMap: Record<string, string[]> = { run: runTypes, cycle: ["Ride", "VirtualRide"], swim: ["Swim"] };
      return (typeMap[pw.activityType] || []).includes(a.activityType);
    });

    if (isPast && !hasCompatible) {
      pastMissed.push(pw.title);
    } else if (isPast && hasCompatible) {
      const act = dayActs.find((a) => runTypes.includes(a.activityType));
      if (act) {
        const dist = act.distanceKm ? `${Number(act.distanceKm).toFixed(1)}km` : "";
        const pace = act.avgPacePerKm || "";
        daySummaries.push(`${pw.title}: done ${dist} ${pace}`);
      }
    } else if (isToday) {
      daySummaries.push(`Today: ${pw.title} (${pw.targetDistanceKm ? Number(pw.targetDistanceKm) + "km" : ""} planned)`);
    }
  }

  // Cross-training
  const crossActivities = weekActivities.filter((a) => !runTypes.includes(a.activityType));
  const crossSummary = crossActivities.length > 0
    ? `Cross-training this week: ${crossActivities.map((a) => `${a.name}`).join(", ")}`
    : "";

  // Build the analysis prompt
  let analysisContext = `Weekly data for ${userName}:\n`;
  if (activePlan) analysisContext += `Active plan: "${activePlan.name}"\n`;
  analysisContext += `Running this week: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned\n`;
  if (daySummaries.length > 0) analysisContext += `Sessions: ${daySummaries.join("; ")}\n`;
  if (pastMissed.length > 0) analysisContext += `Missed: ${pastMissed.join(", ")}\n`;
  if (crossSummary) analysisContext += `${crossSummary}\n`;

  // Trigger-specific context
  let triggerHint = "";
  if (trigger === "new_activity" && latestActivity) {
    const dist = latestActivity.distanceKm ? `${Number(latestActivity.distanceKm).toFixed(1)}km` : "";
    const pace = latestActivity.avgPacePerKm || "";
    triggerHint = `\nTRIGGER: New activity just synced — "${latestActivity.name}" ${dist} ${pace}. React to it specifically.`;
  } else if (trigger === "new_day") {
    const todayPlanned = weekPlanned.find((w) => format(new Date(w.date), "yyyy-MM-dd") === todayStr);
    if (todayPlanned) {
      triggerHint = `\nTRIGGER: New day. Today's workout: ${todayPlanned.title} (${todayPlanned.targetDistanceKm ? Number(todayPlanned.targetDistanceKm) + "km" : ""}). Preview it.`;
    } else {
      triggerHint = `\nTRIGGER: New day. No workout planned today.`;
    }
  }

  if (!activePlan) {
    analysisContext = `${userName} has no active training plan. They have ${weekActivities.length} activities this week.`;
    triggerHint = "\nSuggest building a plan, or ask what they'd like to work on.";
  }

  try {
    const response = await anthropic.messages
      .stream({
        model: "claude-opus-4-6",
        max_tokens: 250,
        system: `You are Brocco, a broccoli running coach. Write a brief data-driven training check-in for ${userName}. 2-4 sentences max. Pattern: quick summary of the week so far + highlight something specific (good or concerning) + what's coming up + open question. Be direct and specific — reference actual numbers. Don't say "Hello" or generic greetings. Today is ${format(now, "EEEE, MMMM d, yyyy")}.`,
        messages: [
          { role: "user", content: `${analysisContext}${triggerHint}\n\nGenerate the opening analysis.` },
        ],
      })
      .finalMessage();

    const openerText =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : `Week check-in: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km so far. What's on your mind?`;

    // Store as assistant message
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: [{ type: "text", text: openerText }],
        displayText: openerText,
      },
    });

    return NextResponse.json({ opener: openerText });
  } catch (err) {
    console.error("Opener generation error:", err);
    const fallback = `Week check-in: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned so far. What's on your mind?`;
    await prisma.chatMessage.create({
      data: { sessionId, role: "assistant", content: [{ type: "text", text: fallback }], displayText: fallback },
    });
    return NextResponse.json({ opener: fallback });
  }
}
