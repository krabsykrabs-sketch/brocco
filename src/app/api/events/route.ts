import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getEventOccurrences, getPlannedWorkouts, parseWall } from "@/lib/schedule";
import type { EventCategory, RecurrenceFreq } from "@prisma/client";

const CATEGORIES = ["work", "family", "training", "social", "health", "birthday", "other"];
const FREQS = ["none", "daily", "weekly", "monthly", "yearly"];

/** GET /api/events?from=yyyy-MM-dd&to=yyyy-MM-dd — expanded occurrences + read-through workouts */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from")?.slice(0, 10);
  const to = searchParams.get("to")?.slice(0, 10);
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from and to (yyyy-MM-dd) required" }, { status: 400 });
  }

  const [events, workouts] = await Promise.all([
    getEventOccurrences(session.userId, from, to),
    getPlannedWorkouts(session.userId, from, to, { includeRest: false }),
  ]);

  return NextResponse.json({ events, workouts });
}

/** POST /api/events — create event (manual form) */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.title || !body.start) {
    return NextResponse.json({ error: "title and start required" }, { status: 400 });
  }

  const allDay = body.allDay ?? String(body.start).length <= 10;
  const event = await prisma.event.create({
    data: {
      userId: session.userId,
      title: String(body.title),
      location: body.location || null,
      notes: body.notes || null,
      category: (CATEGORIES.includes(body.category) ? body.category : "other") as EventCategory,
      startAt: parseWall(String(body.start)),
      endAt: body.end ? parseWall(String(body.end)) : null,
      allDay,
      recurrence: (FREQS.includes(body.recurrence) ? body.recurrence : "none") as RecurrenceFreq,
      recurrenceInterval: body.recurrenceInterval > 0 ? Number(body.recurrenceInterval) : 1,
      recurrenceUntil: body.recurrenceUntil ? parseWall(String(body.recurrenceUntil)) : null,
      recurrenceCount: body.recurrenceCount ? Number(body.recurrenceCount) : null,
      reminderMinutes: body.reminderMinutes != null ? Number(body.reminderMinutes) : null,
    },
  });

  return NextResponse.json({ event: { id: event.id } }, { status: 201 });
}
