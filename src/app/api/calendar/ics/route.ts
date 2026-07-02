import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildIcsFeed } from "@/lib/ics";

/**
 * GET /api/calendar/ics?token=… — the public ICS feed (token-authenticated).
 * Calendar apps poll this URL on their own schedule; it must work without a
 * session cookie, so the token IS the credential.
 */
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 32) {
    return new NextResponse("Not found", { status: 404 });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { icsToken: token },
    select: { userId: true },
  });
  if (!profile) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ics = await buildIcsFeed(profile.userId);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="brocco.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
