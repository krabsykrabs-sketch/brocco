import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await prisma.note.findFirst({ where: { id, userId: session.userId } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = String(body.title).trim();
  if (body.body !== undefined) data.body = String(body.body);
  if (body.tags !== undefined) data.tags = Array.isArray(body.tags) ? body.tags.map(String) : [];

  await prisma.note.update({ where: { id: note.id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await prisma.note.findFirst({ where: { id, userId: session.userId } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.note.delete({ where: { id: note.id } });
  return NextResponse.json({ ok: true });
}
