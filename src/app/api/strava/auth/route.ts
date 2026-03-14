import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getStravaAuthUrl } from "@/lib/strava";

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.redirect(new URL("/login", process.env.BASE_URL));
  }

  // Use userId as state param to verify on callback
  const authUrl = getStravaAuthUrl(session.userId);
  return NextResponse.redirect(authUrl);
}
