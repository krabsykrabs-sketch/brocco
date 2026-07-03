import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * POST /api/guided-workouts/[id]/complete — mark a session done.
 * Logs a manual strength Activity (unless log:false) so the session counts
 * toward plan completion via the existing activity↔planned-workout matching.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const w = await prisma.guidedWorkout.findFirst({ where: { id, userId: session.userId } });
  if (!w) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const durationMin = Math.min(Math.max(Number(body.durationMin) || w.durationMin, 1), 300);
  const log = body.log !== false;

  const now = new Date();
  const [, activity] = await prisma.$transaction([
    prisma.guidedWorkout.update({
      where: { id: w.id },
      data: { timesCompleted: { increment: 1 }, lastUsedAt: now },
    }),
    ...(log
      ? [
          prisma.activity.create({
            data: {
              userId: session.userId,
              source: "manual" as const,
              name: w.title,
              activityType: "WeightTraining",
              durationMin,
              startDate: now,
              startDateLocal: now,
            },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true, activityId: log && activity ? activity.id : null });
}
