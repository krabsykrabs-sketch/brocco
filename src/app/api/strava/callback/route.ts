import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { exchangeStravaCode, encryptToken, backfillActivities } from "@/lib/strava";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL("/login", process.env.BASE_URL));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL("/settings?strava=denied", process.env.BASE_URL));
  }

  // Verify OAuth state against the cookie set during auth initiation
  const savedState = request.cookies.get("strava_oauth_state")?.value;
  if (!code || !state || !savedState || state !== savedState) {
    console.error("Strava OAuth state mismatch", { state, savedState: savedState ? "[present]" : "[missing]" });
    return NextResponse.redirect(new URL("/settings?strava=error", process.env.BASE_URL));
  }

  try {
    const tokenData = await exchangeStravaCode(code);

    await prisma.userProfile.update({
      where: { userId: session.userId },
      data: {
        stravaAccessToken: encryptToken(tokenData.access_token),
        stravaRefreshToken: encryptToken(tokenData.refresh_token),
        stravaAthleteId: String(tokenData.athlete.id),
        stravaTokenExpiresAt: new Date(tokenData.expires_at * 1000),
      },
    });

    // Trigger backfill in the background (don't block the redirect)
    backfillActivities(session.userId).then((count) => {
      console.log(`Backfill complete for user ${session.userId}: ${count} activities`);
    }).catch((err) => {
      console.error(`Backfill error for user ${session.userId}:`, err);
    });

    // Clear the OAuth state cookie and redirect to settings
    const response = NextResponse.redirect(new URL("/settings?strava=connected", process.env.BASE_URL));
    response.cookies.delete("strava_oauth_state");
    return response;
  } catch (err) {
    console.error("Strava callback error:", err);
    const response = NextResponse.redirect(new URL("/settings?strava=error", process.env.BASE_URL));
    response.cookies.delete("strava_oauth_state");
    return response;
  }
}
