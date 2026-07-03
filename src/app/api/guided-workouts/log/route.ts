import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

/**
 * POST /api/guided-workouts/log — log an ad-hoc session (preset / custom
 * interval timer) as a manual strength activity. Saved workouts use
 * /api/guided-workouts/[id]/complete instead.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "Workout").slice(0, 80);
  const durationMin = Math.min(Math.max(Number(body.durationMin) || 1, 1), 300);

  const now = new Date();
  const activity = await prisma.activity.create({
    data: {
      userId: session.userId,
      source: "manual",
      name: title,
      activityType: "WeightTraining",
      durationMin,
      startDate: now,
      startDateLocal: now,
    },
  });

  return NextResponse.json({ ok: true, activityId: activity.id }, { status: 201 });
}
