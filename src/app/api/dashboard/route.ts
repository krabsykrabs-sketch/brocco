import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { startOfWeek, endOfWeek, subWeeks, format, differenceInDays, addDays } from "date-fns";

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

    // Fetch activities for current week
    const currentWeekActivities = await prisma.activity.findMany({
      where: {
        userId,
        startDateLocal: { gte: weekStart, lte: weekEnd },
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

    // Fetch planned workouts for current week
    const currentWeekPlanned = await prisma.plannedWorkout.findMany({
      where: {
        plan: { userId, status: "active" },
        date: { gte: weekStart, lte: weekEnd },
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
        matchedActivityId: true,
      },
    });

    // Build 7-day grid
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dayStr = format(day, "yyyy-MM-dd");
      const dayActivities = currentWeekActivities.filter(
        (a) => format(new Date(a.startDateLocal), "yyyy-MM-dd") === dayStr
      );
      const dayPlanned = currentWeekPlanned.filter(
        (w) => format(new Date(w.date), "yyyy-MM-dd") === dayStr
      );
      weekDays.push({
        date: dayStr,
        dayName: format(day, "EEE"),
        dayNum: format(day, "d"),
        isToday: format(now, "yyyy-MM-dd") === dayStr,
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
          matchedActivityId: w.matchedActivityId,
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

    // Current week total km — running only for plan comparison
    const runTypes = ["Run", "TrailRun", "VirtualRun", "Treadmill"];
    const currentWeekRunKm = currentWeekActivities
      .filter((a) => runTypes.includes(a.activityType))
      .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

    // All activities km (including cycling, swimming, etc.)
    const currentWeekAllKm = currentWeekActivities
      .reduce((sum, a) => sum + (a.distanceKm ? Number(a.distanceKm) : 0), 0);

    // Current week planned km (running plan target)
    const currentWeekPlannedKm = currentWeekPlanned
      .filter((w) => w.workoutType !== "rest")
      .reduce((sum, w) => sum + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

    // Days until race
    const daysUntilRace = profile.goalRaceDate
      ? differenceInDays(new Date(profile.goalRaceDate), now)
      : null;

    // Recent easy pace (average of last 5 easy/recovery runs, pace < 7:00/km i.e. > 420 s/km is not easy)
    const recentRuns = await prisma.activity.findMany({
      where: {
        userId,
        activityType: { in: ["Run", "TrailRun", "VirtualRun"] },
        paceSecondsPerKm: { not: null, gte: 300, lte: 480 },
      },
      orderBy: { startDate: "desc" },
      take: 5,
      select: { paceSecondsPerKm: true },
    });

    let avgEasyPace: string | null = null;
    if (recentRuns.length > 0) {
      const avgSecs = Math.round(
        recentRuns.reduce((sum, r) => sum + (r.paceSecondsPerKm || 0), 0) / recentRuns.length
      );
      const mins = Math.floor(avgSecs / 60);
      const secs = avgSecs % 60;
      avgEasyPace = `${mins}:${secs.toString().padStart(2, "0")}/km`;
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
      daysUntilRace,
      currentWeekKm: Math.round(currentWeekRunKm * 10) / 10,
      currentWeekAllKm: Math.round(currentWeekAllKm * 10) / 10,
      currentWeekPlannedKm: Math.round(currentWeekPlannedKm * 10) / 10,
      avgEasyPace,
      weekDays,
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
