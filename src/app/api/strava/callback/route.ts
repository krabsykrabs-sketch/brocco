import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { exchangeStravaCode, encryptToken, backfillActivities } from "@/lib/strava";
import { analyzeEligibleActivities } from "@/lib/activity-analysis";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL("/login", process.env.BASE_URL));
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Re-validate on the way out too (defense in depth — the cookie is
  // httpOnly but the value originated from a query parameter).
  const rawReturnTo = request.cookies.get("strava_return_to")?.value || "/settings";
  const returnTo = rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//") ? rawReturnTo : "/settings";

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

    // Always trigger backfill after Strava connect
    backfillActivities(session.userId).then(async ({ newCount, newActivities }) => {
      console.log(`Backfill complete for user ${session.userId}: ${newCount} new activities`);
      await analyzeEligibleActivities(session.userId, newActivities);
    }).catch((err) => {
      console.error(`Backfill error for user ${session.userId}:`, err);
    });

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
