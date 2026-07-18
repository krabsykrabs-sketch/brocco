import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { resolveFeatures } from "@/lib/features";

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
      hrMaxBpm: profile.hrMaxBpm,
      features: resolveFeatures(profile.features),
      icsFeedUrl: profile.icsToken ? `${process.env.BASE_URL}/api/calendar/ics?token=${profile.icsToken}` : null,
      stravaConnected: !!profile.stravaAccessToken,
      stravaAthleteId: profile.stravaAthleteId,
      intervalsConnected: !!profile.intervalsApiKey,
      intervalsAthleteId: profile.intervalsAthleteId,
      onboardingCompleted: profile.onboardingCompleted,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, timezone, goalRace, goalTime, goalRaceDate, hrMaxBpm, features } = body;

    if (name !== undefined) {
      await prisma.user.update({
        where: { id: session.userId },
        data: { name },
      });
    }

    const profileUpdate: Record<string, unknown> = {};
    if (timezone !== undefined) profileUpdate.timezone = timezone;
    if (goalRace !== undefined) profileUpdate.goalRace = goalRace || null;
    if (goalTime !== undefined) profileUpdate.goalTime = goalTime || null;
    if (goalRaceDate !== undefined) {
      profileUpdate.goalRaceDate = goalRaceDate ? new Date(goalRaceDate) : null;
    }
    if (hrMaxBpm !== undefined) {
      const n = Number(hrMaxBpm);
      profileUpdate.hrMaxBpm = hrMaxBpm && n > 0 && n < 250 ? Math.round(n) : null;
    }
    if (features !== undefined) {
      // Normalize through resolveFeatures so only known keys with boolean
      // values are ever stored
      profileUpdate.features = resolveFeatures(features) as unknown as object;
    }

    if (Object.keys(profileUpdate).length > 0) {
      await prisma.userProfile.update({
        where: { userId: session.userId },
        data: profileUpdate,
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
