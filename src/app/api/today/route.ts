import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getAgenda, todayInTimezone, parseWall } from "@/lib/schedule";
import { isCompatibleType, RUN_TYPES } from "@/lib/activity-types";
import { resolveFeatures } from "@/lib/features";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";

/**
 * GET /api/today — everything the Today screen needs in one fetch.
 * The morning briefing is fetched separately (/api/briefing) because it can
 * take a few seconds to generate.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = session.userId;

    const [user, profile] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      prisma.userProfile.findUnique({ where: { userId } }),
    ]);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const today = todayInTimezone(profile.timezone);
    const todayDate = parseWall(today);
    const features = resolveFeatures(profile.features);

    // --- Today's agenda: events + workouts (incl. rest) + due/overdue tasks ---
    // Disabled domains come back empty so the Today screen naturally shows
    // the classic training-only view.
    const agenda = await getAgenda(userId, today, today, {
      includeOverdueTodos: true,
      today,
      includeRestWorkouts: true,
    });
    if (!features.calendar) agenda.events = [];
    agenda.todos = [];

    // --- Today's actual activities (to mark the workout as done) ---
    const dayStart = todayDate;
    const dayEnd = parseWall(`${today}T23:59`);
    const todayActivities = await prisma.activity.findMany({
      where: { userId, startDateLocal: { gte: dayStart, lte: dayEnd } },
      orderBy: { startDateLocal: "asc" },
      select: {
        id: true, name: true, activityType: true, distanceKm: true,
        avgPacePerKm: true, avgHeartRate: true, durationMin: true,
      },
    });

    const workouts = agenda.workouts.map((w) => ({
      ...w,
      completed:
        w.status === "completed" ||
        todayActivities.some((a) => isCompatibleType(w.activityType, a.activityType)),
    }));

    // --- Week summary (Mon-Sun around the user's today) ---
    const weekStart = startOfWeek(todayDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(todayDate, { weekStartsOn: 1 });

    const [weekActivities, weekPlanned, activePlan] = await Promise.all([
      prisma.activity.findMany({
        where: { userId, startDateLocal: { gte: weekStart, lte: weekEnd } },
        select: { activityType: true, distanceKm: true, startDateLocal: true },
      }),
      prisma.plannedWorkout.findMany({
        where: { plan: { userId, status: "active" }, date: { gte: weekStart, lte: weekEnd } },
        select: { weekNumber: true, workoutType: true, activityType: true, targetDistanceKm: true, date: true },
      }),
      prisma.plan.findFirst({
        where: { userId, status: "active" },
        select: { id: true, name: true, raceDate: true },
      }),
    ]);

    const weekRunKm = weekActivities
      .filter((a) => RUN_TYPES.includes(a.activityType))
      .reduce((s, a) => s + (a.distanceKm ? Number(a.distanceKm) : 0), 0);
    // Planned volume is a RUNNING metric. Summing per-workout distances
    // undercounts whenever a run carries no target_distance_km (e.g. a plain
    // "Easy Run"), which made actual mileage look over target. The plan's
    // per-week target_km is the authoritative figure — fetched below and used
    // when present; the run-only workout sum is just a fallback.
    const weekPlannedKmFallback = weekPlanned
      .filter((w) => w.workoutType !== "rest" && w.activityType === "run")
      .reduce((s, w) => s + (w.targetDistanceKm ? Number(w.targetDistanceKm) : 0), 0);

    let completedSessions = 0;
    const nonRest = weekPlanned.filter((w) => w.workoutType !== "rest");
    for (const w of nonRest) {
      const wDate = w.date.toISOString().slice(0, 10);
      if (wDate > today) continue;
      const dayActs = weekActivities.filter(
        (a) => format(new Date(a.startDateLocal), "yyyy-MM-dd") === wDate
      );
      if (dayActs.some((a) => isCompatibleType(w.activityType, a.activityType))) completedSessions++;
    }

    let totalWeeks = 0;
    let currentPhaseName: string | null = null;
    let currentWeekTargetKm: number | null = null;
    const currentWeekNumber = weekPlanned[0]?.weekNumber ?? null;
    if (activePlan) {
      const weeks = await prisma.planWeek.findMany({
        where: { planId: activePlan.id },
        select: { weekNumber: true, targetKm: true, phase: { select: { name: true } } },
      });
      totalWeeks = weeks.length;
      if (currentWeekNumber != null) {
        const cw = weeks.find((w) => w.weekNumber === currentWeekNumber);
        currentPhaseName = cw?.phase?.name ?? null;
        currentWeekTargetKm = cw?.targetKm != null ? Number(cw.targetKm) : null;
      }
    }
    // Authoritative planned running volume: the week's target_km, falling back
    // to the run-only workout sum when a plan has no per-week target.
    const weekPlannedKm = currentWeekTargetKm ?? weekPlannedKmFallback;

    const planExpired = activePlan?.raceDate ? new Date(activePlan.raceDate) < new Date() : false;

    // --- Next 3 days preview (small "coming up" strip) ---
    const upcomingAgenda = await getAgenda(
      userId,
      addDays(todayDate, 1).toISOString().slice(0, 10),
      addDays(todayDate, 3).toISOString().slice(0, 10),
      { includeOverdueTodos: false }
    );
    if (!features.calendar) upcomingAgenda.events = [];

    const activityCount = await prisma.activity.count({ where: { userId } });

    return NextResponse.json({
      date: today,
      userName: user?.name || "Runner",
      timezone: profile.timezone,
      events: agenda.events,
      workouts,
      todos: agenda.todos,
      activities: todayActivities.map((a) => ({
        ...a,
        distanceKm: a.distanceKm ? Number(a.distanceKm) : null,
        durationMin: a.durationMin ? Number(a.durationMin) : null,
      })),
      upcoming: {
        events: upcomingAgenda.events,
        workouts: upcomingAgenda.workouts,
      },
      weekSummary: {
        runKm: Math.round(weekRunKm * 10) / 10,
        plannedKm: Math.round(weekPlannedKm * 10) / 10,
        completedSessions,
        totalSessions: nonRest.length,
        weekNumber: currentWeekNumber,
        totalWeeks,
        phaseName: currentPhaseName,
        weekStart: format(weekStart, "MMM d"),
        weekEnd: format(weekEnd, "MMM d"),
      },
      hasActivePlan: !!activePlan,
      planExpired,
      activePlanName: activePlan?.name || null,
      stravaConnected: !!profile.stravaAccessToken,
      stravaNeedsReconnect: profile.stravaNeedsReconnect,
      activityCount,
    });
  } catch (err) {
    console.error("Today error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
