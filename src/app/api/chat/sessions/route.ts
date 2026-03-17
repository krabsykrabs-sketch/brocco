import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startOfDay, endOfDay } from "date-fns";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await prisma.chatSession.findMany({
      where: { userId: session.userId, type: "general" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s._count.messages,
      })),
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

    const now = new Date();

    // Reuse today's general session if one exists
    const todaySession = await prisma.chatSession.findFirst({
      where: {
        userId: session.userId,
        type: "general",
        createdAt: { gte: startOfDay(now), lte: endOfDay(now) },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
    });

    if (todaySession) {
      return NextResponse.json({ id: todaySession.id, title: todaySession.title, reused: true });
    }

    const chatSession = await prisma.chatSession.create({
      data: {
        userId: session.userId,
        title: "New conversation",
      },
    });

    return NextResponse.json({ id: chatSession.id, title: chatSession.title });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
