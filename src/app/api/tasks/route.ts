import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { todayInTimezone, parseWall, wallDateString } from "@/lib/schedule";
import { parseDueDate, resolveListByName } from "@/lib/todos";
import type { Prisma, RecurrenceFreq, TodoPriority } from "@prisma/client";
import { addDays } from "date-fns";

const FREQS = ["none", "daily", "weekly", "monthly", "yearly"];
const PRIORITIES = ["low", "medium", "high"];

function serialize(t: {
  id: string; listId: string | null; parentId: string | null; title: string; notes: string | null;
  dueDate: Date | null; dueTime: string | null; priority: string | null; recurrence: string;
  recurrenceInterval: number; done: boolean; completedAt: Date | null; position: number; createdAt: Date;
}) {
  return {
    id: t.id,
    listId: t.listId,
    parentId: t.parentId,
    title: t.title,
    notes: t.notes,
    dueDate: t.dueDate ? wallDateString(t.dueDate) : null,
    dueTime: t.dueTime,
    priority: t.priority,
    recurrence: t.recurrence,
    recurrenceInterval: t.recurrenceInterval,
    done: t.done,
    completedAt: t.completedAt?.toISOString() ?? null,
    position: t.position,
    createdAt: t.createdAt.toISOString(),
  };
}

/**
 * GET /api/tasks?view=today|upcoming|all&listId=...&includeDone=1
 * "today" = due today + overdue. "upcoming" = due within 14 days (incl. overdue).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "all";
  const listId = searchParams.get("listId");
  const includeDone = searchParams.get("includeDone") === "1";

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.userId },
    select: { timezone: true },
  });
  const today = todayInTimezone(profile?.timezone || "Europe/Berlin");

  const where: Prisma.TodoWhereInput = { userId: session.userId };
  if (!includeDone) where.done = false;
  if (listId) where.listId = listId === "inbox" ? null : listId;

  if (view === "today") {
    where.dueDate = { lte: parseWall(today) };
    where.done = false;
  } else if (view === "upcoming") {
    where.dueDate = { lte: parseWall(wallDateString(addDays(parseWall(today), 14))) };
    where.done = false;
  }

  const todos = await prisma.todo.findMany({
    where,
    orderBy: [{ done: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  return NextResponse.json({ tasks: todos.map(serialize), today });
}

/** POST /api/tasks — create task (manual form / inline add) */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (!body.title || !String(body.title).trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  let listId: string | null = body.listId || null;
  if (!listId && body.listName) {
    listId = (await resolveListByName(session.userId, String(body.listName))).id;
  }

  const task = await prisma.todo.create({
    data: {
      userId: session.userId,
      listId,
      parentId: body.parentId || null,
      title: String(body.title).trim(),
      notes: body.notes || null,
      dueDate: parseDueDate(body.dueDate),
      dueTime: body.dueTime || null,
      priority: (PRIORITIES.includes(body.priority) ? body.priority : null) as TodoPriority | null,
      recurrence: (FREQS.includes(body.recurrence) ? body.recurrence : "none") as RecurrenceFreq,
      recurrenceInterval: body.recurrenceInterval > 0 ? Number(body.recurrenceInterval) : 1,
    },
  });

  return NextResponse.json({ task: serialize(task) }, { status: 201 });
}
