import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/** POST /api/push/unsubscribe — remove this device's subscription. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const endpoint = body?.endpoint;
  if (!endpoint || typeof endpoint !== "string") {
    return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  }

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: session.userId },
  });

  return NextResponse.json({ ok: true });
}
