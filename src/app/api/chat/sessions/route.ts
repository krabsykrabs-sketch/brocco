import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { todayInTimezone, dateInTimezone } from "@/lib/schedule";
import { summarizeStaleSessions } from "@/lib/conversation-memory";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Sidebar lists one chat surface at a time: the coach ("general")
    // or the kitchen chat — never mixed.
    const typeParam = request.nextUrl.searchParams.get("type");
    const type = typeParam === "kitchen" ? "kitchen" : "general";

    const sessions = await prisma.chatSession.findMany({
      where: { userId: session.userId, type },
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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A new session starting is the moment finished conversations become
    // memory. Fire-and-forget — never blocks session creation.
    summarizeStaleSessions(session.userId).catch(() => {});

    // Check if caller wants a fresh session (e.g. for auto-messages like "build my plan")
    let forceNew = false;
    let type: "general" | "kitchen" = "general";
    try {
      const body = await request.json();
      forceNew = !!body?.forceNew;
      if (body?.type === "kitchen") type = "kitchen";
    } catch { /* no body = default behavior */ }

    // "Today" in the USER'S timezone, not the server's (a UTC server rolls
    // the day at 2am Berlin time and would split one evening in two).
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.userId },
      select: { timezone: true },
    });
    const tz = profile?.timezone || "Europe/Berlin";
    const today = todayInTimezone(tz);

    if (!forceNew) {
      // Reuse today's newest session of this type.
      const latest = await prisma.chatSession.findFirst({
        where: { userId: session.userId, type },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, createdAt: true },
      });
      if (latest && dateInTimezone(latest.createdAt, tz) === today) {
        return NextResponse.json({ id: latest.id, title: latest.title, reused: true });
      }
    } else {
      // A fresh session for an auto-sent message — but an EMPTY session from
      // today serves exactly as well. Without this every hand-off link that
      // got abandoned before its message was sent left another "New
      // conversation" in the sidebar.
      const empty = await prisma.chatSession.findFirst({
        where: { userId: session.userId, type, messages: { none: {} } },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, createdAt: true },
      });
      if (empty && dateInTimezone(empty.createdAt, tz) === today) {
        return NextResponse.json({ id: empty.id, title: empty.title, reused: false });
      }
    }

    const chatSession = await prisma.chatSession.create({
      data: {
        userId: session.userId,
        title: type === "kitchen" ? "Kitchen chat" : "New conversation",
        type,
      },
    });

    return NextResponse.json({ id: chatSession.id, title: chatSession.title });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
