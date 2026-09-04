import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillActivities, recordSyncOutcome } from "@/lib/strava";
import { analyzeEligibleActivities } from "@/lib/activity-analysis";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { serverTranslator, userTranslator } from "@/lib/i18n-server";
import { resolveLang } from "@/lib/i18n";

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
    });
    const t = serverTranslator(resolveLang(profile?.language));

    if (!profile?.stravaAccessToken) {
      return NextResponse.json({ error: t("api.strava.notConnected") }, { status: 400 });
    }

    // A full 6-month re-page against Strava's API — once in a while is
    // plenty, and hammering it invites their rate limiter.
    if (!rateLimit(`strava-sync:${session.userId}`, 3, 60 * 60 * 1000)) {
      return NextResponse.json({ error: t("api.strava.syncRecently") }, { status: 429 });
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
    const t = await userTranslator(s.userId ?? "");
    if (s.userId) {
      await recordSyncOutcome(
        s.userId,
        t("api.strava.manualSyncFailed", { reason: err instanceof Error ? err.message : t("api.strava.unknownError") })
      );
    }
    return NextResponse.json({ error: t("api.strava.syncFailed") }, { status: 500 });
  }
}
