import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { validateWorkoutDefinition, estimateDurationMin } from "@/lib/guided-workout";

/** GET /api/guided-workouts — the user's saved workouts, most recent first. */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workouts = await prisma.guidedWorkout.findMany({
    where: { userId: session.userId },
    orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 50,
  });

  return NextResponse.json({
    workouts: workouts.map((w) => ({
      id: w.id,
      title: w.title,
      focus: w.focus,
      durationMin: w.durationMin,
      source: w.source,
      plannedWorkoutId: w.plannedWorkoutId,
      timesCompleted: w.timesCompleted,
      lastUsedAt: w.lastUsedAt?.toISOString() || null,
      createdAt: w.createdAt.toISOString(),
    })),
  });
}

/** POST /api/guided-workouts — save a workout (validated definition). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const title = String(body.title || "").trim();
  if (!title || title.length > 80) return NextResponse.json({ error: "title required (max 80 chars)" }, { status: 400 });

  const validated = validateWorkoutDefinition(body.definition);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const workout = await prisma.guidedWorkout.create({
    data: {
      userId: session.userId,
      title,
      focus: body.focus ? String(body.focus).slice(0, 60) : null,
      durationMin: estimateDurationMin(validated.def),
      definition: validated.def as object,
      source: "brocco",
    },
  });

  return NextResponse.json({ workout: { id: workout.id } }, { status: 201 });
}
