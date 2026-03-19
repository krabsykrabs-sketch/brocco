import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, subDays, format, addDays } from "date-fns";

export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.userId;
    const now = new Date();

    // Fetch profile
    const [user, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ]);

    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Current week (Mon-Sun)
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    // Carousel range: 7 days before today through 7 days after
    const carouselStart = subDays(now, 7);
    const carouselEnd = addDays(now, 7);

    // Fetch activities for carousel range
    const carouselActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: { gte: carouselStart, lte: carouselEnd },
      },
      orderBy: { startDateLocal: "asc" },
      select: {
        id: true,
        name: true,
        activityType: true,
        distanceKm: true,
        durationMin: true,
        avgPacePerKm: true,
        paceSecondsPerKm: true,
        avgHeartRate: true,
        startDateLocal: true,
      },
    });

    // Fetch planned workouts for carousel range
    const carouselPlanned = await prisma.plannedWorkout.findMany({
      where: {
        plan: { userId, status: "active" },
        date: { gte: carouselStart, lte: carouselEnd },
      },
      orderBy: { date: "asc" },
      select: {
        id: true,
        title: true,
        workoutType: true,
        targetDistanceKm: true,
        targetPace: true,
        status: true,
        date: true,
        activityType: true,
      },
    });

    // Build 15-day carousel (7 past + today + 7 future)
    const carouselDays = [];
    for (let i = -7; i <= 7; i++) {
      const day = addDays(now, i);
      const dayStr = format(day, "yyyy-MM-dd");
      const dayActivities = carouselActivities.filter(
        (a) => format(new Date(a.startDateLocal), "yyyy-MM-dd") === dayStr
      );
      const dayPlanned = carouselPlanned.filter(
        (w) => format(new Date(w.date), "yyyy-MM-dd") === dayStr
      );
      carouselDays.push({
        date: dayStr,
        dayName: format(day, "EEE"),
        dayNum: format(day, "d"),
        isToday: i === 0,
        activities: dayActivities.map((a) => ({
          id: a.id,
          name: a.name,
          activityType: a.activityType,
          distanceKm: a.distanceKm ? Number(a.distanceKm) : null,
          avgPacePerKm: a.avgPacePerKm,
          avgHeartRate: a.avgHeartRate,
        })),
        planned: dayPlanned.map((w) => ({
          id: w.id,
          title: w.title,
          workoutType: w.workoutType,
          targetDistanceKm: w.targetDistanceKm ? Number(w.targetDistanceKm) : null,
          targetPace: w.targetPace,
          status: w.status,
          activityType: w.activityType,
        })),
      });
    }

    // Weekly mileage for last 12 weeks (actual + planned)
    const twelveWeeksAgo = subWeeks(weekStart, 11);
    const [allRecentActivities, allPlannedWorkouts] = await Promise.all([
      prisma.activity.findMany({
        where: {
          userId,
          startDateLocal: { gte: twelveWeeksAgo },
          activityType: { in: ["Run", "TrailRun", "VirtualRun", "Treadmill"] },
        },
        select: { distanceKm: true, startDateLocal: true },
      }),
      prisma.plannedWorkout.findMany({
        where: {
          plan: { userId, status: "active" },
          date: { gte: twelveWeeksAgo },
          activityType: "run",
        },
        select: { targetDistanceKm: true, date: true },
      }),
    ]);

    // Group by week
    const weeklyData: { week: string; km: number; plannedKm: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const ws = subWeeks(weekStart, i);
      const we = endOfWeek(ws, { weekStartsOn: 1 });
      const weekLabel = format(ws, "MMM d");
      const weekKm = allRecentActivities
        .filter((a) => {
          const d = new Date(a.startDateLocal);
          return d >= ws && d <= we;
        })
        .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);
      const plannedKm = allPlannedWorkouts
        .filter((w) => {
          const d = new Date(w.date);
          return d >= ws && d <= we;
        })
        .reduce((sum, w) => sum + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);
      weeklyData.push({
        week: weekLabel,
        km: Math.round(weekKm * 10) / 10,
        plannedKm: Math.round(plannedKm * 10) / 10,
      });
    }

    // Current week stats — filter carousel data to current week range
    const weekStartStr = format(weekStart, "yyyy-MM-dd");
    const weekEndStr = format(weekEnd, "yyyy-MM-dd");
    const currentWeekActivities = carouselActivities.filter((a) => {
      const d = format(new Date(a.startDateLocal), "yyyy-MM-dd");
      return d >= weekStartStr && d <= weekEndStr;
    });
    const currentWeekPlanned = carouselPlanned.filter((w) => {
      const d = format(new Date(w.date), "yyyy-MM-dd");
      return d >= weekStartStr && d <= weekEndStr;
    });

    const runTypes = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
    const currentWeekRunKm = currentWeekActivities
      .filter((a) => runTypes.includes(a.activityType))
      .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

    const currentWeekAllKm = currentWeekActivities
      .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

    const currentWeekPlannedKm = currentWeekPlanned
      .filter((w) => w.workoutType !== "rest")
      .reduce((sum, w) => sum + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

    // Cross-training summary: group non-running activities by type
    const crossActivities = currentWeekActivities.filter((a) => !runTypes.includes(a.activityType));
    const crossSummary: { activityType: string; count: number; totalKm: number }[] = [];
    const crossMap = new Map<string, { count: number; totalKm: number }>();
    for (const a of crossActivities) {
      const entry = crossMap.get(a.activityType) || { count: 0, totalKm: 0 };
      entry.count++;
      entry.totalKm += a.distanceKm ? Number(a.distanceKm) : 0;
      crossMap.set(a.activityType, entry);
    }
    for (const [activityType, { count, totalKm }] of crossMap) {
      crossSummary.push({ activityType, count, totalKm: Math.round(totalKm * 10) / 10 });
    }


    // Recent activities (last 10)
    const recentActivities = await prisma.activity.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
      take: 10,
      select: {
        id: true,
        stravaId: true,
        name: true,
        activityType: true,
        distanceKm: true,
        durationMin: true,
        avgPacePerKm: true,
        avgHeartRate: true,
        startDateLocal: true,
        source: true,
      },
    });

    // Check active plan status
    const activePlan = await prisma.plan.findFirst({
      where: { userId, status: "active" },
      select: { id: true, name: true, raceDate: true },
    });
    const hasActivePlan = !!activePlan;
    const planExpired = activePlan?.raceDate
      ? new Date(activePlan.raceDate) < now
      : false;

    // Weekly tasks for current week
    let weeklyTasks: Array<{ id: string; description: string; category: string; status: string }> = [];
    if (activePlan) {
      // Determine current week number from planned workouts
      const todayStr = format(now, "yyyy-MM-dd");
      const currentWeekWorkout = await prisma.plannedWorkout.findFirst({
        where: {
          planId: activePlan.id,
          date: { gte: weekStart, lte: weekEnd },
        },
        select: { weekNumber: true },
      });
      if (currentWeekWorkout) {
        const tasks = await prisma.weeklyTask.findMany({
          where: { planId: activePlan.id, weekNumber: currentWeekWorkout.weekNumber },
          orderBy: { category: "asc" },
          select: { id: true, description: true, category: true, status: true },
        });
        weeklyTasks = tasks;
      }
    }

    // Active health notes
    const healthNotes = await prisma.healthLog.findMany({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        entryType: true,
        description: true,
        bodyPart: true,
        severity: true,
        date: true,
      },
    });

    return NextResponse.json({
      userName: user?.name || "Runner",
      goalRace: profile.goalRace,
      goalTime: profile.goalTime,
      currentWeekKm: Math.round(currentWeekRunKm * 10) / 10,
      currentWeekAllKm: Math.round(currentWeekAllKm * 10) / 10,
      crossTrainingSummary: crossSummary,
      currentWeekPlannedKm: Math.round(currentWeekPlannedKm * 10) / 10,
      carouselDays,
      weeklyData,
      recentActivities: recentActivities.map((a) => ({
        id: a.id,
        stravaId: a.stravaId,
        name: a.name,
        activityType: a.activityType,
        distanceKm: a.distanceKm ? Number(a.distanceKm) : null,
        durationMin: a.durationMin ? Number(a.durationMin) : null,
        avgPacePerKm: a.avgPacePerKm,
        avgHeartRate: a.avgHeartRate,
        startDateLocal: a.startDateLocal,
        source: a.source,
      })),
      healthNotes,
      weeklyTasks,
      hasActivePlan,
      planExpired,
      activePlanName: activePlan?.name || null,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
