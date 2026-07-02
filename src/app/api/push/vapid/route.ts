import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { pushConfigured } from "@/lib/push";

/** GET /api/push/vapid — the public key the client needs to subscribe. */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!pushConfigured()) {
    return NextResponse.json({ configured: false, publicKey: null });
  }
  return NextResponse.json({ configured: true, publicKey: process.env.VAPID_PUBLIC_KEY });
}
