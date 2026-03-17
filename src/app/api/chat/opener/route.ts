import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { format, subDays } from "date-fns";

const anthropic = new Anthropic();

/**
 * Generate a contextual opening message for a new general chat session.
 * Brocco speaks first based on the user's current state.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await request.json();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // Verify session ownership and type
  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: { type: true },
  });
  if (!chatSession || chatSession.type !== "general") {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  // Check if session already has messages (don't double-send)
  const msgCount = await prisma.chatMessage.count({ where: { sessionId } });
  if (msgCount > 0) {
    return NextResponse.json({ error: "Session already has messages" }, { status: 400 });
  }

  const userId = session.userId;
  const now = new Date();

  // Gather context for contextual opener
  const [user, profile, activePlan, recentActivity, todayWorkout, tomorrowWorkout] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.plan.findFirst({
        where: { userId, status: "active" },
        select: { name: true, raceDate: true },
      }),
      prisma.activity.findFirst({
        where: { userId, startDateLocal: { gte: subDays(now, 2) } },
        orderBy: { startDateLocal: "desc" },
        select: {
          name: true,
          activityType: true,
          distanceKm: true,
          avgPacePerKm: true,
          startDateLocal: true,
        },
      }),
      prisma.plannedWorkout.findFirst({
        where: {
          plan: { userId, status: "active" },
          date: { equals: now },
          status: "planned",
        },
        select: { title: true, workoutType: true, targetDistanceKm: true, targetPace: true },
      }),
      prisma.plannedWorkout.findFirst({
        where: {
          plan: { userId, status: "active" },
          date: { equals: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
          status: "planned",
        },
        select: { title: true, workoutType: true, targetDistanceKm: true, targetPace: true },
      }),
    ]);

  const userName = user?.name || "Runner";

  // Build a mini prompt to decide what to say
  let contextHint = "";
  if (!activePlan) {
    contextHint = "The user has NO active training plan. Suggest building one, or offer to just chat.";
  } else if (todayWorkout) {
    const dist = todayWorkout.targetDistanceKm ? `${Number(todayWorkout.targetDistanceKm)}km` : "";
    const pace = todayWorkout.targetPace || "";
    contextHint = `Today's planned workout: ${todayWorkout.workoutType} "${todayWorkout.title}" ${dist} ${pace}. Preview it briefly.`;
  } else if (tomorrowWorkout) {
    const dist = tomorrowWorkout.targetDistanceKm ? `${Number(tomorrowWorkout.targetDistanceKm)}km` : "";
    const pace = tomorrowWorkout.targetPace || "";
    contextHint = `Tomorrow's planned workout: ${tomorrowWorkout.workoutType} "${tomorrowWorkout.title}" ${dist} ${pace}. Mention it.`;
  } else if (recentActivity) {
    const dist = recentActivity.distanceKm ? `${Number(recentActivity.distanceKm).toFixed(1)}km` : "";
    const pace = recentActivity.avgPacePerKm || "";
    const date = format(new Date(recentActivity.startDateLocal), "EEEE");
    contextHint = `Recent activity: ${recentActivity.activityType} "${recentActivity.name}" on ${date}, ${dist} ${pace}. Comment on it briefly and ask how they're feeling.`;
  } else {
    contextHint = "No recent context. Use a friendly general opener.";
  }

  const hasCoachingNotes = profile?.coachingNotes && typeof profile.coachingNotes === "object" && Object.keys(profile.coachingNotes as object).length > 0;

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 200,
      system: `You are Brocco, a broccoli running coach. Write a brief, warm opening message for ${userName}. 1-3 sentences max. End with a question or prompt. Don't use greetings like "Hello!" — be casual. Today is ${format(now, "EEEE, MMMM d, yyyy")}.${!hasCoachingNotes ? " You don't know much about this runner yet." : ""}`,
      messages: [
        {
          role: "user",
          content: `Generate an opening message. Context: ${contextHint}`,
        },
      ],
    });

    const openerText =
      response.content[0].type === "text"
        ? response.content[0].text.trim()
        : "Hey! What's on your mind today? 🥦";

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
    // Fallback opener
    const fallback = "Hey! What's on your mind today? 🥦";
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: [{ type: "text", text: fallback }],
        displayText: fallback,
      },
    });
    return NextResponse.json({ opener: fallback });
  }
}
