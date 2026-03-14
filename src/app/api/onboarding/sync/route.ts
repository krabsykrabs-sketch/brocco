import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { backfillActivities, backfillActivitiesFull, analyzeTrainingHistory } from "@/lib/strava";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
    });

    if (!profile?.stravaAccessToken) {
      return NextResponse.json({ error: "Strava not connected" }, { status: 400 });
    }

    const { depth } = await request.json();
    const isFullHistory = depth === "full";

    // Run backfill
    const count = isFullHistory
      ? await backfillActivitiesFull(session.userId)
      : await backfillActivities(session.userId);

    // For full history, run training analysis and store in coaching_notes
    if (isFullHistory && count > 0) {
      const summary = await analyzeTrainingHistory(session.userId);
      const existing = (profile.coachingNotes as Record<string, unknown>) || {};
      await prisma.userProfile.update({
        where: { userId: session.userId },
        data: {
          coachingNotes: { ...existing, training_history_summary: summary } as object,
        },
      });
    }

    return NextResponse.json({ ok: true, activitiesImported: count, depth: isFullHistory ? "full" : "quick" });
  } catch (err) {
    console.error("Onboarding sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
