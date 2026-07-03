import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { todayInTimezone } from "@/lib/schedule";

function serialize(e: {
  id: string;
  day: string;
  mood: number | null;
  tags: string[];
  text: string | null;
  createdAt: Date;
}) {
  return {
    id: e.id,
    day: e.day,
    mood: e.mood,
    tags: e.tags,
    text: e.text,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * GET /api/journal?limit=30&before=<iso>
 * Entries newest-first with cursor pagination; also returns the user's
 * wall-clock `today` and whether a mood was already logged today (drives
 * the Today-screen check-in card).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(parseInt(params.get("limit") || "30", 10) || 30, 1), 100);
  const before = params.get("before");
  const beforeDate = before ? new Date(before) : null;

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { timezone: true },
  });
  const today = todayInTimezone(profile?.timezone || "Europe/Berlin");

  const [entries, moodToday] = await Promise.all([
    prisma.journalEntry.findMany({
      where: {
        userId: session.userId,
        ...(beforeDate && !isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.journalEntry.findFirst({
      where: { userId: session.userId, day: today, mood: { not: null } },
      select: { id: true, mood: true },
    }),
  ]);

  return NextResponse.json({
    entries: entries.map(serialize),
    today,
    moodToday: moodToday ? { id: moodToday.id, mood: moodToday.mood } : null,
    hasMore: entries.length === limit,
  });
}

/** POST /api/journal — create a mood check-in and/or journal entry. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const mood = body.mood == null ? null : Number(body.mood);
  const text = body.text != null ? String(body.text).trim() : null;
  const tags = Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 10) : [];

  if (mood == null && !text) {
    return NextResponse.json({ error: "mood or text is required" }, { status: 400 });
  }
  if (mood != null && (!Number.isInteger(mood) || mood < 1 || mood > 5)) {
    return NextResponse.json({ error: "mood must be an integer 1-5" }, { status: 400 });
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { timezone: true },
  });
  const day = todayInTimezone(profile?.timezone || "Europe/Berlin");

  const entry = await prisma.journalEntry.create({
    data: { userId: session.userId, day, mood, tags, text: text || null },
  });

  return NextResponse.json({ entry: serialize(entry) }, { status: 201 });
}
