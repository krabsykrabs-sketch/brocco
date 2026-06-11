import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const list = await prisma.taskList.findFirst({ where: { id, userId: session.userId } });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.emoji !== undefined) data.emoji = body.emoji || null;
  if (body.position !== undefined) data.position = Number(body.position);

  await prisma.taskList.update({ where: { id: list.id }, data });
  return NextResponse.json({ ok: true });
}

/** DELETE — tasks in the list fall back to Inbox (FK SetNull) */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const list = await prisma.taskList.findFirst({ where: { id, userId: session.userId } });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.taskList.delete({ where: { id: list.id } });
  return NextResponse.json({ ok: true });
}
