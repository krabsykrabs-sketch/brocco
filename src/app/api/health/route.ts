import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// GET /api/health — List active health notes
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const notes = await prisma.healthLog.findMany({
    where: { userId: session.userId, status: "active" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      entryType: true,
      description: true,
      bodyPart: true,
      severity: true,
      date: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ notes });
}

// POST /api/health — Create a health note (manual quick-add)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entryType, description, bodyPart, severity } = body;

  if (!entryType || !description) {
    return NextResponse.json(
      { error: "entryType and description required" },
      { status: 400 }
    );
  }

  const note = await prisma.healthLog.create({
    data: {
      userId: session.userId,
      date: new Date(),
      entryType,
      description,
      bodyPart: bodyPart || null,
      severity: severity || null,
      status: "active",
    },
  });

  return NextResponse.json({ note }, { status: 201 });
}

// PATCH /api/health — Resolve a health note
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { id, status } = body;

  if (!id || !status) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  const note = await prisma.healthLog.findFirst({
    where: { id, userId: session.userId },
  });

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.healthLog.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json({ note: updated });
}

// DELETE /api/health — Delete a health note
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const note = await prisma.healthLog.findFirst({
    where: { id, userId: session.userId },
  });

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.healthLog.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
