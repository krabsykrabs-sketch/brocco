import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { currentWeekStart, reconcileWeek } from "@/lib/weekly-goals";
import { wallDateString, addDaysWall } from "@/lib/schedule";

/**
 * GET /api/goals — this week's flexible goals with live progress.
 *
 * Reconciling on read (rather than on activity import) means a late Strava sync
 * or a deleted activity is reflected the next time anyone looks, instead of
 * leaving a stale count behind.
 */
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { timezone: true },
  });
  const weekStart = currentWeekStart(profile?.timezone || "Europe/Berlin");
  const goals = await reconcileWeek(session.userId, weekStart);

  return NextResponse.json({
    weekStart: wallDateString(weekStart),
    weekEnd: wallDateString(addDaysWall(weekStart, 6)),
    goals,
  });
}
