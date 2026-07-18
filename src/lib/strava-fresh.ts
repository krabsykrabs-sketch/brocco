import { prisma } from "@/lib/db";
import { syncRecentActivities } from "@/lib/strava";
import { analyzeEligibleActivities } from "@/lib/activity-analysis";

// How stale the last sync may be before a chat interaction triggers a new
// incremental sync. 15 minutes keeps API usage trivial (max ~4 calls/hour
// per active user, against a 100 req/15min limit) while guaranteeing the
// coach never talks over hours-old data.
const FRESH_WINDOW_MS = 15 * 60 * 1000;

/**
 * Make sure the local activities table reflects Strava before the coach
 * builds context. Cheap no-op when synced within the last 15 minutes or
 * Strava isn't connected. Never throws — chat must work even if Strava is
 * down; the webhook and daily auto-sync remain the backstops.
 *
 * Lives in its own module (not strava.ts) because it needs
 * analyzeEligibleActivities, and activity-analysis already imports strava.
 */
export async function ensureFreshStravaData(userId: string): Promise<{ newCount: number }> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { stravaAccessToken: true, stravaLastSyncAt: true },
    });
    if (!profile?.stravaAccessToken) return { newCount: 0 };
    if (
      profile.stravaLastSyncAt &&
      Date.now() - profile.stravaLastSyncAt.getTime() < FRESH_WINDOW_MS
    ) {
      return { newCount: 0 };
    }

    // Optimistic-lock claim (same pattern as /api/strava/auto-sync): only
    // proceed if stravaLastSyncAt is unchanged since we read it, so a
    // concurrent chat request or auto-sync doesn't double-fetch.
    const claim = await prisma.userProfile.updateMany({
      where: { userId, stravaLastSyncAt: profile.stravaLastSyncAt },
      data: { stravaLastSyncAt: new Date() },
    });
    if (claim.count === 0) return { newCount: 0 };

    try {
      const { newCount, newActivities } = await syncRecentActivities(userId, {
        lastSyncAt: profile.stravaLastSyncAt,
      });
      await analyzeEligibleActivities(userId, newActivities);
      return { newCount };
    } catch (err) {
      console.error("[strava-fresh] sync failed:", err);
      // Release the claim so the next interaction can retry immediately
      await prisma.userProfile
        .updateMany({
          where: { userId },
          data: { stravaLastSyncAt: profile.stravaLastSyncAt },
        })
        .catch(() => {});
      return { newCount: 0 };
    }
  } catch (err) {
    console.error("[strava-fresh] unexpected error:", err);
    return { newCount: 0 };
  }
}
