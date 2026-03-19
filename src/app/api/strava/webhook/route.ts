import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getValidToken, fetchStravaActivity, storeStravaActivity } from "@/lib/strava";

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

    console.log(`[webhook] Received: object_type=${event.object_type}, aspect_type=${event.aspect_type}, owner_id=${event.owner_id}, object_id=${event.object_id}`);

    // Only handle activity events
    if (event.object_type !== "activity") {
      console.log(`[webhook] Ignoring non-activity event: ${event.object_type}`);
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
      console.warn(`[webhook] No user found for athlete_id=${athleteId}. Check that stravaAthleteId is stored in userProfile.`);
      return NextResponse.json({ ok: true });
    }

    const userId = profile.userId;
    console.log(`[webhook] Matched athlete_id=${athleteId} to user_id=${userId}, aspect=${aspectType}, activity_id=${activityId}`);

    if (aspectType === "delete") {
      // Remove the activity if it exists
      const deleted = await prisma.activity.deleteMany({
        where: { stravaId: activityId, userId },
      });
      console.log(`[webhook] Deleted ${deleted.count} activity records for strava_id=${activityId}`);
      return NextResponse.json({ ok: true });
    }

    // For create/update: fetch full activity and store it
    try {
      const token = await getValidToken(userId);
      const stravaActivity = await fetchStravaActivity(token, activityId);
      const stored = await storeStravaActivity(userId, stravaActivity, profile.timezone);
      console.log(`[webhook] Stored activity: strava_id=${activityId}, db_id=${stored.id}, type=${stored.activityType}`);
    } catch (err) {
      console.error(`[webhook] Failed to process activity ${activityId} for user ${userId}:`, err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook] Error processing event:", err);
    return NextResponse.json({ ok: true }); // Always return 200 to Strava
  }
}
