import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [profile, user, activePlan] = await Promise.all([
      prisma.userProfile.findUnique({
        where: { userId: session.userId },
      }),
      prisma.user.findUnique({
        where: { id: session.userId },
        select: { name: true },
      }),
      prisma.plan.findFirst({
        where: { userId: session.userId, status: "active" },
        select: { id: true },
      }),
    ]);

    return NextResponse.json({
      name: user?.name || "",
      onboardingCompleted: profile?.onboardingCompleted || false,
      stravaConnected: !!profile?.stravaAccessToken,
      hasActivePlan: !!activePlan,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.userProfile.update({
      where: { userId: session.userId },
      data: { onboardingCompleted: true },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
