import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { format } from "date-fns";
import { todayInTimezone, nowInTimezone, dateInTimezone, parseWall, wallDateString } from "@/lib/schedule";
import { groupActivitiesByDay, workoutOutcome, activityDayKey } from "@/lib/plan-progress";
import { ensureFreshStravaData } from "@/lib/strava-fresh";
import { groundStatusMarker } from "@/app/api/chat/route";
import { COACH_MODEL } from "@/lib/models";
import { renderWeeklyGoalsLine } from "@/lib/weekly-goals";
import { generateNumberChecked } from "@/lib/number-guard";
import { weekTrainingFigures } from "@/lib/week-training";

const anthropic = new Anthropic();

/**
 * POST /api/chat/opener
 * Generate a contextual, data-driven opening message for Brocco — or decide
 * that none is due and return { skipped: true }.
 *
 * The gate lives HERE, server-side (profile.lastOpenerAt), not in client
 * localStorage: one analysis per local day, plus a fresh one when a new
 * activity has landed since the last opener. Multi-device safe — phone and
 * desktop share the same gate, and an optimistic-lock claim prevents two
 * simultaneous opens from double-generating.
 *
 * Body: { sessionId }
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

  const chatSession = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: { type: true },
  });
  if (!chatSession || chatSession.type !== "general") {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }

  const userId = session.userId;

  // Sync first — a run finished 20 minutes ago must be able to trigger the
  // "new activity" opener rather than being invisible until tomorrow.
  await ensureFreshStravaData(userId);

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const tz = profile?.timezone || "Europe/Berlin";
  const todayStr = todayInTimezone(tz);

  // Latest activity BY ARRIVAL TIME (createdAt) — a Strava workout that
  // synced late should still trigger a fresh look, whenever it was run.
  const latestArrival = await prisma.activity.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, name: true, activityType: true, distanceKm: true, avgPacePerKm: true, durationMin: true, startDateLocal: true },
  });

  const lastOpenerAt = profile?.lastOpenerAt ?? null;
  let trigger: "new_session" | "new_day" | "new_activity";
  if (!lastOpenerAt) {
    trigger = "new_session";
  } else if (dateInTimezone(lastOpenerAt, tz) !== todayStr) {
    trigger = "new_day";
  } else if (latestArrival && latestArrival.createdAt > lastOpenerAt) {
    trigger = "new_activity";
  } else {
    return NextResponse.json({ skipped: true });
  }

  // Claim the opener slot — only one device/request generates it
  const claim = await prisma.userProfile.updateMany({
    where: { userId, lastOpenerAt },
    data: { lastOpenerAt: new Date() },
  });
  if (claim.count === 0) {
    return NextResponse.json({ skipped: true });
  }
  // Week figures come from one shared, tested place. The pad this query needs
  // for timezone offsets was previously never trimmed back off, so last
  // Sunday's run counted into this week — see lib/week-training.ts.
  const figures = await weekTrainingFigures(userId, todayStr);
  const { weekStartWall, activities: weekActivities, planned: weekPlanned, runKm: weekRunKm, plannedKm } = figures;

  const [user, activePlan] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.plan.findFirst({
      where: { userId, status: "active" },
      select: { name: true, raceDate: true },
    }),
  ]);

  const userName = user?.name || "Runner";

  // Day-by-day reconciliation — the SAME matcher the plan tab and chat
  // context use, covering every activity type (incl. strength/WeightTraining
  // from the in-app player, which the old inline map silently dropped).
  const byDay = groupActivitiesByDay(weekActivities);
  const daySummaries: string[] = [];
  const pastMissed: string[] = [];
  const matchedIds = new Set<string>();

  for (const pw of weekPlanned) {
    const dateStr = wallDateString(pw.date);
    const { outcome, matched } = workoutOutcome(
      { dateStr, activityType: pw.activityType, workoutType: pw.workoutType, status: pw.status },
      byDay,
      todayStr
    );
    if (matched) matchedIds.add(matched.id);
    if (outcome === "rest") continue;
    if (outcome === "missed") {
      pastMissed.push(pw.title);
    } else if (outcome === "done") {
      if (matched) {
        const dist = matched.distanceKm ? `${Number(matched.distanceKm).toFixed(1)}km` : "";
        const dur = matched.durationMin ? `${Math.round(Number(matched.durationMin))}min` : "";
        const pace = matched.avgPacePerKm || "";
        daySummaries.push(`${pw.title}: done ${[dist, dur, pace].filter(Boolean).join(" ")}`.trim());
      } else {
        daySummaries.push(`${pw.title}: done`);
      }
    } else if (outcome === "today_pending") {
      daySummaries.push(`Today: ${pw.title} (${pw.targetDistanceKm ? Number(pw.targetDistanceKm) + "km " : ""}planned, not done yet)`);
    }
  }

  // Unplanned extras this week (spontaneous sessions, cross-training)
  const extras = weekActivities.filter(
    (a) => !matchedIds.has(a.id) && activityDayKey(a.startDateLocal) >= wallDateString(weekStartWall)
  );
  const extrasSummary = extras.length > 0
    ? `Extra (unplanned) this week: ${extras
        .map((a) => {
          // Distances matter here: without them the session list cannot be
          // reconciled against the weekly total, and an unreconcilable list is
          // an invitation to invent the missing number.
          const dist = a.distanceKm ? ` ${Number(a.distanceKm).toFixed(1)}km` : "";
          const dur = !a.distanceKm && a.durationMin ? ` ${Math.round(Number(a.durationMin))}min` : "";
          return `${a.activityType} "${a.name}"${dist}${dur}`;
        })
        .join(", ")}`
    : "";

  let analysisContext = `Weekly data for ${userName}:\n`;
  if (activePlan) analysisContext += `Active plan: "${activePlan.name}"\n`;
  analysisContext += `Running this week: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned\n`;
  if (daySummaries.length > 0) analysisContext += `Sessions: ${daySummaries.join("; ")}\n`;
  if (pastMissed.length > 0) analysisContext += `Missed (day fully over, no matching activity): ${pastMissed.join(", ")}\n`;
  if (extrasSummary) analysisContext += `${extrasSummary}\n`;

  // Trigger-specific context
  let triggerHint = "";
  if (trigger === "new_activity" && latestArrival) {
    const dist = latestArrival.distanceKm ? `${Number(latestArrival.distanceKm).toFixed(1)}km` : "";
    const dur = latestArrival.durationMin ? `${Math.round(Number(latestArrival.durationMin))}min` : "";
    const pace = latestArrival.avgPacePerKm || "";
    triggerHint = `\nTRIGGER: A new activity just came in since you last spoke — ${latestArrival.activityType} "${latestArrival.name}" ${[dist, dur, pace].filter(Boolean).join(" ")}. React to it specifically; do NOT repeat the general week summary you already gave earlier today.`;
  } else if (trigger === "new_day") {
    const todayPlanned = weekPlanned.find((w) => wallDateString(w.date) === todayStr && w.workoutType !== "rest");
    if (todayPlanned) {
      triggerHint = `\nTRIGGER: First check-in today. Today's workout: ${todayPlanned.title} (${todayPlanned.targetDistanceKm ? Number(todayPlanned.targetDistanceKm) + "km" : ""}). Preview it — it hasn't happened yet unless listed as done.`;
    } else {
      triggerHint = `\nTRIGGER: First check-in today. No workout planned today.`;
    }
  }

  if (!activePlan) {
    analysisContext = `${userName} has no active training plan. They have ${weekActivities.length} activities this week.`;
    // With no Strava there's no history to coach from, so connecting it beats
    // jumping into a plan built on guesswork.
    triggerHint += profile?.stravaAccessToken
      ? "\nSuggest building a plan, or ask what they'd like to work on."
      : "\nThey have NOT connected Strava, so you have no training history for them. Introduce yourself in a sentence and ask them to connect Strava (Settings, or the button on Today), explaining it lets you build the plan around what they actually run instead of a pile of questions. Mention they can still build a plan without it if they prefer.";
  }

  const timeNow = nowInTimezone(tz).slice(11, 16);
  const goalsLine = await renderWeeklyGoalsLine(userId, tz);

  const source = `${analysisContext}${triggerHint}${goalsLine}`;
  const systemPrompt = `You are Brocco, a broccoli running coach. Write a brief data-driven training check-in for ${userName}. 2-4 sentences max. Pattern: quick summary of the week so far + highlight something specific (good or concerning) + what's coming up + open question. Be direct and specific. NUMBERS: quote only figures that appear in the data below, exactly as written. Never calculate, sum or estimate a distance — if a number you want is not in the data, leave it out and say it qualitatively instead. Running kilometres and bike kilometres are separate; never add them together. Don't say "Hello" or generic greetings. Today is ${format(parseWall(todayStr), "EEEE, MMMM d, yyyy")} and the current LOCAL TIME is ${timeNow} — never treat today's still-pending workout as missed or overdue. End with a status line: [STATUS:question]your question[/STATUS] or [STATUS:info]key insight[/STATUS].`;

  try {
    // Distances are checked against the data block before this reaches the
    // athlete: the coach once reported 22.3km on a week where 12.2km was
    // supplied, and prose was the one thing nothing verified.
    const checked = await generateNumberChecked(
      source,
      // A coach may legitimately state the shortfall, which is a subtraction of
      // two supplied figures rather than an invention.
      [Math.max(0, plannedKm - weekRunKm)],
      "opener",
      async (correction) => {
        const res = await anthropic.messages
          .stream({
            model: COACH_MODEL,
            // Opus 5 thinks by default; thinking shares the cap. Low effort
            // suits a short data-grounded check-in.
            max_tokens: 4000,
            output_config: { effort: "low" },
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content: `${source}\n\nGenerate the opening analysis.${correction ? `\n\n${correction}` : ""}`,
              },
            ],
          })
          .finalMessage();
        const block = res.content.find((c) => c.type === "text");
        return block && block.type === "text" ? block.text.trim() : "";
      }
    );

    const openerText =
      checked || `Week check-in: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km so far. What's on your mind?`;

    // The opener calls no tools, so a [STATUS:done] here can never be true.
    const grounded = groundStatusMarker(openerText, false);

    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: [{ type: "text", text: grounded }],
        displayText: grounded,
      },
    });

    return NextResponse.json({ opener: grounded });
  } catch (err) {
    console.error("Opener generation error:", err);
    const fallback = `Week check-in: ${weekRunKm.toFixed(1)}km of ${plannedKm.toFixed(0)}km planned so far. What's on your mind?`;
    await prisma.chatMessage.create({
      data: { sessionId, role: "assistant", content: [{ type: "text", text: fallback }], displayText: fallback },
    });
    return NextResponse.json({ opener: fallback });
  }
}
