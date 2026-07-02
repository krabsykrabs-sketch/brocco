import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/** POST /api/push/subscribe — store this device's push subscription. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;

  if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  // Endpoint is globally unique per device+origin; upsert handles both
  // re-subscribes and a device switching accounts
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.userId,
      endpoint,
      p256dh: String(p256dh),
      auth: String(auth),
      userAgent: request.headers.get("user-agent")?.slice(0, 255) || null,
    },
    update: {
      userId: session.userId,
      p256dh: String(p256dh),
      auth: String(auth),
    },
  });

  return NextResponse.json({ ok: true });
}
