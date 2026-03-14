import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if an onboarding session already exists
    const existing = await prisma.chatSession.findFirst({
      where: { userId: session.userId, type: "onboarding" },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json({ id: existing.id });
    }

    // Create new onboarding session
    const chatSession = await prisma.chatSession.create({
      data: {
        userId: session.userId,
        title: "Onboarding with Brocco",
        type: "onboarding",
      },
    });

    return NextResponse.json({ id: chatSession.id });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
