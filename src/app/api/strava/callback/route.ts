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

  const returnTo = request.cookies.get("strava_return_to")?.value || "/settings";

  if (error) {
    const response = NextResponse.redirect(new URL(`${returnTo}?strava=denied`, process.env.BASE_URL));
    response.cookies.delete("strava_return_to");
    return response;
  }

  // Verify OAuth state against the cookie set during auth initiation
  const savedState = request.cookies.get("strava_oauth_state")?.value;
  if (!code || !state || !savedState || state !== savedState) {
    console.error("Strava OAuth state mismatch", { state, savedState: savedState ? "[present]" : "[missing]" });
    const response = NextResponse.redirect(new URL(`${returnTo}?strava=error`, process.env.BASE_URL));
    response.cookies.delete("strava_return_to");
    return response;
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

    // If coming from settings, trigger backfill automatically
    // From onboarding, sync is triggered separately with depth choice
    if (returnTo === "/settings") {
      backfillActivities(session.userId).then((count) => {
        console.log(`Backfill complete for user ${session.userId}: ${count} activities`);
      }).catch((err) => {
        console.error(`Backfill error for user ${session.userId}:`, err);
      });
    }

    // Clear cookies and redirect
    const response = NextResponse.redirect(new URL(`${returnTo}?strava=connected`, process.env.BASE_URL));
    response.cookies.delete("strava_oauth_state");
    response.cookies.delete("strava_return_to");
    return response;
  } catch (err) {
    console.error("Strava callback error:", err);
    const response = NextResponse.redirect(new URL(`${returnTo}?strava=error`, process.env.BASE_URL));
    response.cookies.delete("strava_oauth_state");
    response.cookies.delete("strava_return_to");
    return response;
  }
}
