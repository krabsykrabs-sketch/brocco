import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/** GET /api/task-lists — all lists with open-task counts (Inbox is virtual: listId null) */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [lists, inboxCount] = await Promise.all([
    prisma.taskList.findMany({
      where: { userId: session.userId },
      orderBy: { position: "asc" },
      include: { _count: { select: { todos: { where: { done: false } } } } },
    }),
    prisma.todo.count({ where: { userId: session.userId, listId: null, done: false, parentId: null } }),
  ]);

  return NextResponse.json({
    inbox: { openCount: inboxCount },
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      emoji: l.emoji,
      position: l.position,
      openCount: l._count.todos,
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const count = await prisma.taskList.count({ where: { userId: session.userId } });
  const list = await prisma.taskList.create({
    data: { userId: session.userId, name, emoji: body.emoji || null, position: count },
  });
  return NextResponse.json({ list: { id: list.id, name: list.name, emoji: list.emoji } }, { status: 201 });
}
