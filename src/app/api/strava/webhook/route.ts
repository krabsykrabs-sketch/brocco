import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getValidToken, fetchStravaActivity, storeStravaActivity } from "@/lib/strava";
import { autoMatchActivity } from "@/lib/auto-match";

/**
 * GET: Strava webhook verification (subscription creation).
 * Strava sends hub.mode, hub.verify_token, hub.challenge.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const verifyToken = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && verifyToken === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ "hub.challenge": challenge });
  }

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * POST: Strava webhook event.
 * Receives activity create/update/delete events.
 */
export async function POST(request: NextRequest) {
  try {
    const event = await request.json();

    // Only handle activity events
    if (event.object_type !== "activity") {
      return NextResponse.json({ ok: true });
    }

    const athleteId = String(event.owner_id);
    const activityId = String(event.object_id);
    const aspectType = event.aspect_type; // create, update, delete

    // Find user by strava athlete ID
    const profile = await prisma.userProfile.findFirst({
      where: { stravaAthleteId: athleteId },
    });

    if (!profile) {
      console.warn(`Webhook: no user found for athlete ${athleteId}`);
      return NextResponse.json({ ok: true });
    }

    const userId = profile.userId;

    if (aspectType === "delete") {
      // Remove the activity if it exists
      await prisma.activity.deleteMany({
        where: { stravaId: activityId, userId },
      });
      return NextResponse.json({ ok: true });
    }

    // For create/update: fetch full activity and store it
    try {
      const token = await getValidToken(userId);
      const stravaActivity = await fetchStravaActivity(token, activityId);
      const stored = await storeStravaActivity(userId, stravaActivity, profile.timezone);
      // Auto-match to planned workout
      await autoMatchActivity(stored.id, userId);
    } catch (err) {
      console.error(`Webhook: failed to process activity ${activityId} for user ${userId}:`, err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json({ ok: true }); // Always return 200 to Strava
  }
}
