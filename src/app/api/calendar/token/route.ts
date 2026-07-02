import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * POST /api/calendar/token — create (or rotate) the ICS subscribe URL.
 * The token is a bearer secret: anyone with the URL can read the calendar,
 * which is how calendar subscriptions work everywhere. Rotation invalidates
 * the previous URL.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let rotate = false;
  try {
    const body = await request.json();
    rotate = !!body?.rotate;
  } catch { /* no body */ }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { icsToken: true },
  });

  let token = profile?.icsToken ?? null;
  if (!token || rotate) {
    token = crypto.randomBytes(24).toString("hex");
    await prisma.userProfile.update({
      where: { userId: session.userId },
      data: { icsToken: token },
    });
  }

  return NextResponse.json({
    url: `${process.env.BASE_URL}/api/calendar/ics?token=${token}`,
    rotated: rotate,
  });
}
