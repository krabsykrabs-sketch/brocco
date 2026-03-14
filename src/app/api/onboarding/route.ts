import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
    });

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true },
    });

    return NextResponse.json({
      name: user?.name || "",
      yearsRunning: profile?.yearsRunning,
      weeklyKmBaseline: profile?.weeklyKmBaseline ? Number(profile.weeklyKmBaseline) : null,
      goalRace: profile?.goalRace,
      goalRaceDate: profile?.goalRaceDate,
      goalTime: profile?.goalTime,
      timezone: profile?.timezone || "Europe/Berlin",
      onboardingCompleted: profile?.onboardingCompleted || false,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, yearsRunning, weeklyKmBaseline, goalRace, goalRaceDate, goalTime, timezone } = body;

    // Update user name
    if (name) {
      await prisma.user.update({
        where: { id: session.userId },
        data: { name },
      });
    }

    // Update profile
    await prisma.userProfile.update({
      where: { userId: session.userId },
      data: {
        yearsRunning: yearsRunning != null ? Number(yearsRunning) : undefined,
        weeklyKmBaseline: weeklyKmBaseline != null ? Number(weeklyKmBaseline) : undefined,
        goalRace: goalRace || undefined,
        goalRaceDate: goalRaceDate ? new Date(goalRaceDate) : undefined,
        goalTime: goalTime || undefined,
        timezone: timezone || undefined,
        onboardingCompleted: true,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
