import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { setTodoDone, parseDueDate } from "@/lib/todos";
import { wallDateString } from "@/lib/schedule";
import type { RecurrenceFreq, TodoPriority } from "@prisma/client";

const FREQS = ["none", "daily", "weekly", "monthly", "yearly"];
const PRIORITIES = ["low", "medium", "high"];

/** PATCH /api/tasks/[id] — update fields and/or toggle done (recurrence-aware) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  // Done toggle goes through the recurrence-aware helper
  let nextOccurrenceDate: string | null = null;
  if (body.done !== undefined) {
    const result = await setTodoDone(session.userId, id, !!body.done);
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.nextOccurrence?.dueDate) {
      nextOccurrenceDate = wallDateString(result.nextOccurrence.dueDate);
    }
  }

  const fieldKeys = ["title", "notes", "dueDate", "dueTime", "priority", "listId", "recurrence", "recurrenceInterval", "position"];
  if (fieldKeys.some((k) => body[k] !== undefined)) {
    const task = await prisma.todo.findFirst({ where: { id, userId: session.userId } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = String(body.title);
    if (body.notes !== undefined) data.notes = body.notes || null;
    if (body.dueDate !== undefined) data.dueDate = parseDueDate(body.dueDate);
    if (body.dueTime !== undefined) data.dueTime = body.dueTime || null;
    if (body.priority !== undefined) data.priority = (PRIORITIES.includes(body.priority) ? body.priority : null) as TodoPriority | null;
    if (body.listId !== undefined) data.listId = body.listId || null;
    if (body.recurrence !== undefined) data.recurrence = (FREQS.includes(body.recurrence) ? body.recurrence : "none") as RecurrenceFreq;
    if (body.recurrenceInterval !== undefined) data.recurrenceInterval = body.recurrenceInterval > 0 ? Number(body.recurrenceInterval) : 1;
    if (body.position !== undefined) data.position = Number(body.position);

    await prisma.todo.update({ where: { id: task.id }, data });
  }

  return NextResponse.json({ ok: true, nextOccurrenceDate });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const task = await prisma.todo.findFirst({ where: { id, userId: session.userId } });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.todo.delete({ where: { id: task.id } });
  return NextResponse.json({ ok: true });
}
