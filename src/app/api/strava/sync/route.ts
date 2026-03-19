import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillActivities } from "@/lib/strava";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
    });

    if (!profile?.stravaAccessToken) {
      return NextResponse.json({ error: "Strava not connected" }, { status: 400 });
    }

    const { newCount, totalChecked } = await backfillActivities(session.userId);
    return NextResponse.json({ ok: true, newCount, totalChecked });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
