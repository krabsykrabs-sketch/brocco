import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { RUN_TYPES, CYCLE_TYPES, SWIM_TYPES, HIKE_TYPES, STRENGTH_TYPES, CLIMB_TYPES } from "@/lib/activity-types";

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

    // Filter by sport GROUP, not the raw stored sport_type — "Run" must
    // match TrailRun/VirtualRun/Treadmill too, "Ride" all the ride variants.
    // Unknown values fall back to an exact match so old links keep working.
    const typeGroup: Record<string, string[]> = {
      Run: RUN_TYPES,
      Ride: CYCLE_TYPES,
      Swim: SWIM_TYPES,
      Hike: HIKE_TYPES,
      Walk: HIKE_TYPES,
      WeightTraining: STRENGTH_TYPES,
      RockClimbing: CLIMB_TYPES,
    };
    const where = {
      userId: session.userId,
      ...(type ? { activityType: typeGroup[type] ? { in: typeGroup[type] } : type } : {}),
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
