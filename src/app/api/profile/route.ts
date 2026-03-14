import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, email: true },
    });

    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
    });

    if (!user || !profile) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      name: user.name,
      email: user.email,
      timezone: profile.timezone,
      goalRace: profile.goalRace,
      goalTime: profile.goalTime,
      goalRaceDate: profile.goalRaceDate,
      yearsRunning: profile.yearsRunning,
      weeklyKmBaseline: profile.weeklyKmBaseline ? Number(profile.weeklyKmBaseline) : null,
      stravaConnected: !!profile.stravaAccessToken,
      stravaAthleteId: profile.stravaAthleteId,
      onboardingCompleted: profile.onboardingCompleted,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
