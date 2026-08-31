import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * DELETE /api/guided-workouts/sessions/[id] — the undo behind auto-logging:
 * removes the session row, its logged activity, and rolls back the saved
 * workout's completion counter.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const row = await prisma.guidedWorkoutSession.findFirst({
    where: { id, userId: session.userId },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction([
    prisma.guidedWorkoutSession.delete({ where: { id: row.id } }),
    ...(row.activityId
      ? [prisma.activity.deleteMany({ where: { id: row.activityId, userId: session.userId } })]
      : []),
    ...(row.guidedWorkoutId && row.completed
      ? [
          prisma.guidedWorkout.updateMany({
            where: { id: row.guidedWorkoutId, userId: session.userId, timesCompleted: { gt: 0 } },
            data: { timesCompleted: { decrement: 1 } },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
