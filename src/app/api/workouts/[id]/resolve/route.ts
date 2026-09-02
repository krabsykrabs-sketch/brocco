import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { MANUAL_TYPE_FOR_KIND, isCompatibleType } from "@/lib/activity-types";

/**
 * POST /api/workouts/[id]/resolve — the one-tap answer to "did it happen?"
 * for sessions the app cannot detect on its own (climbing, off-app strength,
 * anything Strava doesn't record). Body: { outcome: "done" | "skipped",
 * durationMin? }.
 *
 * "done" marks the planned workout completed AND logs a manual activity on
 * that day, so weekly goals, the plan's session counts and Brocco's context
 * all see it through the exact matching path a Strava activity takes — no
 * second bookkeeping system. "skipped" records a decision, not a lapse.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;

  const { id } = await params;
  const w = await prisma.plannedWorkout.findFirst({
    where: { id, plan: { userId } },
    select: { id: true, title: true, date: true, activityType: true, targetDurationMin: true },
  });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const outcome = body.outcome === "skipped" ? "skipped" : body.outcome === "done" ? "done" : null;
  if (!outcome) return NextResponse.json({ error: 'outcome must be "done" or "skipped"' }, { status: 400 });

  if (outcome === "skipped") {
    await prisma.plannedWorkout.update({ where: { id: w.id }, data: { status: "skipped" } });
    return NextResponse.json({ ok: true, outcome });
  }

  // Don't log a second activity if a compatible one already landed that day
  // (a late Strava sync, or a session played in the workout timer).
  const dayStart = w.date;
  const dayEnd = new Date(w.date.getTime() + 86_400_000 - 1);
  const sameDay = await prisma.activity.findMany({
    where: { userId, startDateLocal: { gte: dayStart, lte: dayEnd } },
    select: { id: true, activityType: true },
  });
  const existing = sameDay.find((a) => isCompatibleType(w.activityType, a.activityType));

  let activityId = existing?.id ?? null;
  if (!existing) {
    // Noon on the workout's wall day: keeps the same day key in any nearby
    // timezone, unlike midnight which sits right on the boundary.
    const at = new Date(w.date.getTime() + 12 * 3_600_000);
    const durationMin = Math.min(Math.max(Number(body.durationMin) || w.targetDurationMin || 45, 1), 600);
    const activity = await prisma.activity.create({
      data: {
        userId,
        source: "manual",
        name: w.title,
        activityType: MANUAL_TYPE_FOR_KIND[w.activityType] || "Workout",
        durationMin,
        startDate: at,
        startDateLocal: at,
      },
    });
    activityId = activity.id;
  }

  await prisma.plannedWorkout.update({ where: { id: w.id }, data: { status: "completed" } });
  return NextResponse.json({ ok: true, outcome, activityId });
}
