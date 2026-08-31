import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillActivities, recordSyncOutcome } from "@/lib/strava";
import { analyzeEligibleActivities } from "@/lib/activity-analysis";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST() {
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

    // A full 6-month re-page against Strava's API — once in a while is
    // plenty, and hammering it invites their rate limiter.
    if (!rateLimit(`strava-sync:${session.userId}`, 3, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Sync already ran recently — give it an hour." }, { status: 429 });
    }

    const { newCount, totalChecked, newActivities } = await backfillActivities(session.userId);
    // Backfilled runs used to arrive with no zone/HR analysis until each was
    // opened by hand — analyze what's new so trends light up immediately.
    await analyzeEligibleActivities(session.userId, newActivities);
    await recordSyncOutcome(session.userId, null);
    return NextResponse.json({ ok: true, newCount, totalChecked });
  } catch (err) {
    console.error("Sync error:", err);
    const s = await getSession();
    if (s.userId) {
      await recordSyncOutcome(s.userId, `Manual sync failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
