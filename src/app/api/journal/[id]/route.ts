import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findFirst({ where: { id, userId: session.userId } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.mood !== undefined) {
    const mood = body.mood == null ? null : Number(body.mood);
    if (mood != null && (!Number.isInteger(mood) || mood < 1 || mood > 5)) {
      return NextResponse.json({ error: "mood must be an integer 1-5" }, { status: 400 });
    }
    data.mood = mood;
  }
  if (body.text !== undefined) data.text = body.text ? String(body.text).trim() : null;
  if (body.tags !== undefined) {
    data.tags = Array.isArray(body.tags)
      ? body.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 10)
      : [];
  }

  await prisma.journalEntry.update({ where: { id: entry.id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findFirst({ where: { id, userId: session.userId } });
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.journalEntry.delete({ where: { id: entry.id } });
  return NextResponse.json({ ok: true });
}
