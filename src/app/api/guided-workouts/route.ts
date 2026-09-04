import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { validateWorkoutDefinition, estimateDurationMin } from "@/lib/guided-workout";
import { userTranslator } from "@/lib/i18n-server";

/** GET /api/guided-workouts — the user's saved workouts, most recent first. */
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [workouts, profile] = await Promise.all([
    prisma.guidedWorkout.findMany({
      where: { userId: session.userId },
      orderBy: [{ pinned: "desc" }, { lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.userProfile.findUnique({
      where: { userId: session.userId },
      select: { primarySport: true },
    }),
  ]);

  // plannedWorkoutId is a soft link — resolve the dates that still exist so
  // the client can tuck away plan sessions whose day has long passed.
  const plannedIds = workouts.map((w) => w.plannedWorkoutId).filter((id): id is string => !!id);
  const planned = plannedIds.length
    ? await prisma.plannedWorkout.findMany({
        where: { id: { in: plannedIds } },
        select: { id: true, date: true },
      })
    : [];
  const plannedDate = new Map(planned.map((p) => [p.id, p.date.toISOString().slice(0, 10)]));

  return NextResponse.json({
    primarySport: profile?.primarySport || null,
    workouts: workouts.map((w) => ({
      id: w.id,
      title: w.title,
      focus: w.focus,
      durationMin: w.durationMin,
      source: w.source,
      plannedWorkoutId: w.plannedWorkoutId,
      plannedDate: (w.plannedWorkoutId && plannedDate.get(w.plannedWorkoutId)) || null,
      timesCompleted: w.timesCompleted,
      pinned: w.pinned,
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
  if (!title || title.length > 80) {
    const t = await userTranslator(session.userId);
    return NextResponse.json({ error: t("api.validation.workout.titleRequired", { max: 80 }) }, { status: 400 });
  }

  const validated = validateWorkoutDefinition(body.definition);
  if (!validated.ok) {
    const t = await userTranslator(session.userId);
    return NextResponse.json({ error: t(`api.validation.workout.${validated.code}`, validated.vars) }, { status: 400 });
  }

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
