import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

// GET /api/plan/tasks?week=N — Get weekly tasks for current plan
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const week = request.nextUrl.searchParams.get("week");

  const plan = await prisma.plan.findFirst({
    where: { userId: session.userId, status: "active" },
    select: { id: true },
  });

  if (!plan) {
    return NextResponse.json({ tasks: [] });
  }

  const where: Record<string, unknown> = { planId: plan.id };
  if (week) where.weekNumber = parseInt(week);

  const tasks = await prisma.weeklyTask.findMany({
    where,
    orderBy: [{ weekNumber: "asc" }, { category: "asc" }],
  });

  return NextResponse.json({ tasks });
}

// PATCH /api/plan/tasks — Toggle task status
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, status } = await request.json();
  if (!id || !["pending", "done"].includes(status)) {
    return NextResponse.json({ error: "id and status required" }, { status: 400 });
  }

  // Verify ownership through plan
  const task = await prisma.weeklyTask.findFirst({
    where: { id },
    include: { plan: { select: { userId: true } } },
  });

  if (!task || task.plan.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.weeklyTask.update({
    where: { id },
    data: { status },
  });

  return NextResponse.json({ ok: true });
}
