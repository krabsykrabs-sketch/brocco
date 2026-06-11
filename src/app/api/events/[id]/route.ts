import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseWall, wallString } from "@/lib/schedule";
import type { EventCategory, RecurrenceFreq } from "@prisma/client";

const CATEGORIES = ["work", "family", "training", "social", "health", "birthday", "other"];
const FREQS = ["none", "daily", "weekly", "monthly", "yearly"];

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const event = await prisma.event.findFirst({ where: { id, userId: session.userId } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    event: {
      id: event.id,
      title: event.title,
      location: event.location,
      notes: event.notes,
      category: event.category,
      start: wallString(event.startAt),
      end: event.endAt ? wallString(event.endAt) : null,
      allDay: event.allDay,
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval,
      recurrenceUntil: event.recurrenceUntil ? wallString(event.recurrenceUntil).slice(0, 10) : null,
      recurrenceCount: event.recurrenceCount,
      reminderMinutes: event.reminderMinutes,
    },
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const event = await prisma.event.findFirst({ where: { id, userId: session.userId } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = String(body.title);
  if (body.location !== undefined) data.location = body.location || null;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.category !== undefined && CATEGORIES.includes(body.category)) data.category = body.category as EventCategory;
  if (body.start !== undefined) data.startAt = parseWall(String(body.start));
  if (body.end !== undefined) data.endAt = body.end ? parseWall(String(body.end)) : null;
  if (body.allDay !== undefined) data.allDay = !!body.allDay;
  if (body.recurrence !== undefined) {
    data.recurrence = (FREQS.includes(body.recurrence) ? body.recurrence : "none") as RecurrenceFreq;
    data.recurrenceInterval = body.recurrenceInterval > 0 ? Number(body.recurrenceInterval) : 1;
    data.recurrenceUntil = body.recurrenceUntil ? parseWall(String(body.recurrenceUntil)) : null;
    data.recurrenceCount = body.recurrenceCount ? Number(body.recurrenceCount) : null;
  }
  if (body.reminderMinutes !== undefined) {
    data.reminderMinutes = body.reminderMinutes != null ? Number(body.reminderMinutes) : null;
  }

  await prisma.event.update({ where: { id: event.id }, data });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/events/[id]?scope=occurrence&date=yyyy-MM-dd — or whole series by default */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const event = await prisma.event.findFirst({ where: { id, userId: session.userId } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get("scope") === "occurrence" && event.recurrence !== "none") {
    const date = searchParams.get("date")?.slice(0, 10);
    if (!date) return NextResponse.json({ error: "date required for occurrence delete" }, { status: 400 });
    const exdates = Array.isArray(event.exdates) ? (event.exdates as string[]) : [];
    if (!exdates.includes(date)) exdates.push(date);
    await prisma.event.update({ where: { id: event.id }, data: { exdates } });
    return NextResponse.json({ ok: true, removedOccurrence: date });
  }

  await prisma.event.delete({ where: { id: event.id } });
  return NextResponse.json({ ok: true });
}
