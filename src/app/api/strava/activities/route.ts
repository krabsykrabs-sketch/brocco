import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const type = searchParams.get("type") || undefined;

    const where = {
      userId: session.userId,
      ...(type ? { activityType: type } : {}),
    };

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where,
        orderBy: { startDate: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          source: true,
          stravaId: true,
          name: true,
          activityType: true,
          distanceKm: true,
          durationMin: true,
          movingTimeMin: true,
          avgPacePerKm: true,
          paceSecondsPerKm: true,
          avgHeartRate: true,
          maxHeartRate: true,
          elevationGainM: true,
          perceivedEffort: true,
          startDate: true,
          startDateLocal: true,
        },
      }),
      prisma.activity.count({ where }),
    ]);

    return NextResponse.json({
      activities,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
