import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { applyPlanGeneration, applyPlanModifications } from "@/lib/apply-plan";

// POST /api/plan/changes — Approve or reject a pending plan change
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, action } = await request.json();

  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json(
      { error: "id and action (approve|reject) required" },
      { status: 400 }
    );
  }

  const change = await prisma.pendingPlanChange.findFirst({
    where: { id, userId: session.userId, status: "pending" },
  });

  if (!change) {
    return NextResponse.json({ error: "Pending change not found" }, { status: 404 });
  }

  // Check expiry
  if (new Date() > change.expiresAt) {
    await prisma.pendingPlanChange.update({
      where: { id },
      data: { status: "expired", resolvedAt: new Date() },
    });
    return NextResponse.json({ error: "Change has expired" }, { status: 410 });
  }

  if (action === "reject") {
    await prisma.pendingPlanChange.update({
      where: { id },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    return NextResponse.json({ success: true, status: "rejected" });
  }

  // Check if this is a plan generation or a plan modification
  const payload = change.changes as Record<string, unknown>;

  if (payload.type === "generate_plan") {
    await applyPlanGeneration(session.userId, payload);
  } else {
    // Regular modifications
    const changes = change.changes as Array<{
      action: string;
      workout_id?: string;
      date?: string;
      updates?: Record<string, unknown>;
      reason?: string;
    }>;
    await applyPlanModifications(session.userId, changes);
  }

  await prisma.pendingPlanChange.update({
    where: { id },
    data: { status: "approved", resolvedAt: new Date() },
  });

  return NextResponse.json({ success: true, status: "approved" });
}
