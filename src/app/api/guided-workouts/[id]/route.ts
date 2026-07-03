import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const w = await prisma.guidedWorkout.findFirst({ where: { id, userId: session.userId } });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    workout: {
      id: w.id,
      title: w.title,
      focus: w.focus,
      durationMin: w.durationMin,
      definition: w.definition,
      source: w.source,
      plannedWorkoutId: w.plannedWorkoutId,
      timesCompleted: w.timesCompleted,
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const w = await prisma.guidedWorkout.findFirst({ where: { id, userId: session.userId } });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.guidedWorkout.delete({ where: { id: w.id } });
  return NextResponse.json({ ok: true });
}
