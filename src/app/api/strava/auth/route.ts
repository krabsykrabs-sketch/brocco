import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/session";
import { getStravaAuthUrl } from "@/lib/strava";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL("/login", process.env.BASE_URL));
  }

  const returnTo = new URL(request.url).searchParams.get("returnTo") || "/settings";

  // Generate a random state token for CSRF protection
  const state = randomBytes(32).toString("hex");
  const authUrl = getStravaAuthUrl(state);

  const response = NextResponse.redirect(authUrl);

  // Store state in a short-lived cookie so the callback can verify it
  response.cookies.set("strava_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  // Store returnTo so callback knows where to redirect
  response.cookies.set("strava_return_to", returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  return response;
}
