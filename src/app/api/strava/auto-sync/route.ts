import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { syncRecentActivities } from "@/lib/strava";
import { todayInTimezone, dateInTimezone } from "@/lib/schedule";
import { analyzeEligibleActivities } from "@/lib/activity-analysis";

/**
 * GET /api/strava/auto-sync — silent, once-per-local-day incremental sync.
 * Called on every app open; the server is the source of truth for the
 * once-a-day gate (client-side localStorage is just an optimization to skip
 * the round-trip, not the guard itself — covers multi-device/cleared storage).
 * Always 200s with a `skipped` reason rather than erroring, since this runs
 * unattended and shouldn't surface failures to the user.
 */
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ skipped: "unauthenticated" }, { status: 200 });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { stravaAccessToken: true, stravaLastSyncAt: true, timezone: true },
  });

  if (!profile?.stravaAccessToken) {
    return NextResponse.json({ skipped: "not_connected" });
  }

  const today = todayInTimezone(profile.timezone);
  if (profile.stravaLastSyncAt && dateInTimezone(profile.stravaLastSyncAt, profile.timezone) === today) {
    return NextResponse.json({ skipped: "already_synced_today", lastSyncAt: profile.stravaLastSyncAt });
  }

  try {
    const { newCount, totalChecked, newActivities } = await syncRecentActivities(session.userId);
    // Analysis failures are swallowed per-activity inside this call — a bad
    // streams fetch shouldn't turn a successful sync into an error response.
    await analyzeEligibleActivities(session.userId, newActivities);
    return NextResponse.json({ ok: true, newCount, totalChecked });
  } catch (err) {
    console.error("Auto-sync error:", err);
    return NextResponse.json({ skipped: "error" });
  }
}
