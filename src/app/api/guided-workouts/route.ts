import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { validateWorkoutDefinition, estimateDurationMin } from "@/lib/guided-workout";
import { userTranslator } from "@/lib/i18n-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/guided-workouts?kind=sc|yoga — the user's saved workouts, most recent first.
 * GET /api/guided-workouts?plannedWorkoutId=<id> — the one session linked to a
 * plan entry (with its full definition, so the calendar can list the
 * exercises), or `{ workout: null }` when none has been built yet.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const plannedWorkoutId = request.nextUrl.searchParams.get("plannedWorkoutId");
  if (plannedWorkoutId) {
    // The column is a uuid — a malformed id would make Prisma throw, and it
    // can only mean "no session", so answer that directly.
    if (!UUID_RE.test(plannedWorkoutId)) return NextResponse.json({ workout: null });
    const w = await prisma.guidedWorkout.findFirst({
      where: { userId: session.userId, plannedWorkoutId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, focus: true, durationMin: true, kind: true, definition: true },
    });
    return NextResponse.json({ workout: w ?? null });
  }

  const kindParam = request.nextUrl.searchParams.get("kind");
  const kind = kindParam === "sc" || kindParam === "yoga" ? kindParam : null;

  const [workouts, profile] = await Promise.all([
    prisma.guidedWorkout.findMany({
      where: { userId: session.userId, ...(kind ? { kind } : {}) },
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
      kind: w.kind,
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

  // kind may come top-level or inside the definition; it goes into the
  // definition BEFORE validation so the yoga rules apply, and onto the row.
  const rawDef = body.definition && typeof body.definition === "object" ? body.definition : null;
  const kind: "sc" | "yoga" = body.kind === "yoga" || rawDef?.kind === "yoga" ? "yoga" : "sc";
  const validated = validateWorkoutDefinition(rawDef ? { ...rawDef, kind } : body.definition);
  if (!validated.ok) {
    const t = await userTranslator(session.userId);
    return NextResponse.json({ error: t(`api.validation.workout.${validated.code}`, validated.vars) }, { status: 400 });
  }
  const def = { ...validated.def, kind };

  const workout = await prisma.guidedWorkout.create({
    data: {
      userId: session.userId,
      title,
      focus: body.focus ? String(body.focus).slice(0, 60) : null,
      durationMin: estimateDurationMin(def),
      definition: def as object,
      kind,
      source: "brocco",
    },
  });

  return NextResponse.json({ workout: { id: workout.id } }, { status: 201 });
}
