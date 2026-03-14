import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create a new plan creation chat session
    const chatSession = await prisma.chatSession.create({
      data: {
        userId: session.userId,
        title: "New training plan",
        type: "plan_creation",
      },
    });

    return NextResponse.json({ id: chatSession.id });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
