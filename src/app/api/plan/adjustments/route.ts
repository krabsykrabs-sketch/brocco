import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// GET /api/plan/adjustments — List recent adjustments (for dashboard notifications)
export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Last 7 days of adjustments, not undone
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const adjustments = await prisma.planAdjustmentLog.findMany({
    where: {
      userId: session.userId,
      createdAt: { gte: weekAgo },
      undone: false,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      action: true,
      summary: true,
      reason: true,
      beforeState: true,
      afterState: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ adjustments });
}

// POST /api/plan/adjustments — Undo an adjustment
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const adjustment = await prisma.planAdjustmentLog.findFirst({
    where: { id, userId: session.userId, undone: false },
  });

  if (!adjustment) {
    return NextResponse.json({ error: "Adjustment not found" }, { status: 404 });
  }

  // Restore the before state
  const beforeState = adjustment.beforeState as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  if (beforeState.targetDistanceKm !== undefined) updateData.targetDistanceKm = beforeState.targetDistanceKm;
  if (beforeState.targetPace !== undefined) updateData.targetPace = beforeState.targetPace;
  if (beforeState.targetDurationMin !== undefined) updateData.targetDurationMin = beforeState.targetDurationMin;
  if (beforeState.status !== undefined) updateData.status = beforeState.status;

  await prisma.plannedWorkout.update({
    where: { id: adjustment.workoutId },
    data: updateData,
  });

  await prisma.planAdjustmentLog.update({
    where: { id },
    data: { undone: true },
  });

  return NextResponse.json({ success: true });
}
