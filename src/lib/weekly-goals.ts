import { prisma } from "@/lib/db";
import { parseWall, wallDateString, addDaysWall, todayInTimezone } from "@/lib/schedule";

/**
 * Flexible weekly goals — "do this N times this week", days unspecified.
 *
 * Progress is credited from real activities rather than ticked by hand. Credits
 * are written EAGERLY: a session counts the moment it appears, and if more than
 * one goal could have claimed it the credit is flagged `provisional` for the
 * coach to confirm later. Registering first and correcting afterwards keeps the
 * count honest-high rather than artificially low — a wrong credit is a question,
 * a missing one is invisible.
 */

/**
 * Which Strava/in-app activity types satisfy each category. Strength and
 * mobility overlap deliberately at "Workout", Strava's catch-all: a session
 * tagged that way genuinely could be either, which is exactly the ambiguity
 * `provisional` exists to record.
 */
const CATEGORY_ACTIVITY_TYPES: Record<string, string[]> = {
  strength: ["WeightTraining", "Crossfit", "Workout"],
  mobility: ["Yoga", "Pilates", "Workout"],
  recovery: ["Yoga", "Walk", "Hike"],
  // Nothing in an activity feed evidences a nutrition goal, and "other" is too
  // vague to guess at. Both are tracked, neither auto-credits.
  nutrition: [],
  other: [],
};

export function categoryCounts(category: string, activityType: string): boolean {
  return (CATEGORY_ACTIVITY_TYPES[category] || []).includes(activityType);
}

/** Monday of the week containing `dateStr` (yyyy-MM-dd), as a wall Date. */
export function weekStartOf(dateStr: string): Date {
  const wall = parseWall(dateStr);
  const dow = wall.getUTCDay() === 0 ? 7 : wall.getUTCDay();
  return addDaysWall(wall, -(dow - 1));
}

/** Monday of the current week in the user's timezone. */
export function currentWeekStart(timezone: string): Date {
  return weekStartOf(todayInTimezone(timezone));
}

export interface GoalProgress {
  id: string;
  label: string;
  category: string;
  target: number;
  done: number;
  /** Credits the coach should confirm, because another goal could have claimed them. */
  provisional: { activityId: string; name: string; date: string }[];
  met: boolean;
  /** Auto-credited from the activity feed, or manual-only (nutrition/other). */
  autoTracked: boolean;
}

/**
 * Credits any uncredited activity in the week to a matching goal, then reports
 * progress. Safe to call on every read: crediting is idempotent through the
 * (goal, activity) unique index, and it self-corrects when a late Strava sync
 * brings in a session after the fact.
 */
export async function reconcileWeek(
  userId: string,
  weekStart: Date
): Promise<GoalProgress[]> {
  const goals = await prisma.weeklyGoal.findMany({
    where: { userId, weekStart },
    orderBy: { createdAt: "asc" },
    include: { credits: true },
  });
  if (goals.length === 0) return [];

  const weekEnd = addDaysWall(weekStart, 6);
  const activities = await prisma.activity.findMany({
    where: {
      userId,
      startDateLocal: {
        gte: new Date(weekStart.getTime() - 86400000),
        lte: new Date(weekEnd.getTime() + 2 * 86400000),
      },
    },
    select: { id: true, name: true, activityType: true, startDateLocal: true },
    orderBy: { startDateLocal: "asc" },
  });

  // Trim the timezone pad back to the real week
  const startKey = wallDateString(weekStart);
  const endKey = wallDateString(weekEnd);
  const inWeek = activities.filter((a) => {
    const k = wallDateString(a.startDateLocal);
    return k >= startKey && k <= endKey;
  });

  // (goalId, activityId) pairs already decided — including dismissals, so a
  // rejected credit is never silently recreated on the next pass.
  const decided = new Set<string>();
  const creditedActivities = new Set<string>();
  for (const g of goals) {
    for (const c of g.credits) {
      decided.add(`${g.id}:${c.activityId}`);
      if (!c.dismissed) creditedActivities.add(c.activityId);
    }
  }

  const counts = new Map<string, number>();
  for (const g of goals) {
    counts.set(g.id, g.credits.filter((c) => !c.dismissed).length);
  }

  const toCreate: { goalId: string; activityId: string; provisional: boolean }[] = [];
  for (const a of inWeek) {
    if (creditedActivities.has(a.id)) continue;
    const candidates = goals.filter(
      (g) => categoryCounts(g.category, a.activityType) && !decided.has(`${g.id}:${a.id}`)
    );
    if (candidates.length === 0) continue;
    // Prefer a goal that still has room, so one session doesn't overfill a met
    // goal while another sits short.
    const target =
      candidates.find((g) => (counts.get(g.id) ?? 0) < g.targetCount) ?? candidates[0];
    toCreate.push({ goalId: target.id, activityId: a.id, provisional: candidates.length > 1 });
    counts.set(target.id, (counts.get(target.id) ?? 0) + 1);
    creditedActivities.add(a.id);
  }

  if (toCreate.length > 0) {
    await prisma.weeklyGoalCredit.createMany({ data: toCreate, skipDuplicates: true });
  }

  const byId = new Map(inWeek.map((a) => [a.id, a]));
  return goals.map((g) => {
    const fresh = toCreate.filter((c) => c.goalId === g.id);
    const kept = g.credits.filter((c) => !c.dismissed);
    const provisional = [
      ...kept.filter((c) => c.provisional).map((c) => c.activityId),
      ...fresh.filter((c) => c.provisional).map((c) => c.activityId),
    ];
    const done = kept.length + fresh.length;
    return {
      id: g.id,
      label: g.label,
      category: g.category,
      target: g.targetCount,
      done,
      met: done >= g.targetCount,
      autoTracked: (CATEGORY_ACTIVITY_TYPES[g.category] || []).length > 0,
      provisional: provisional
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((a) => ({
          activityId: a!.id,
          name: a!.name,
          date: wallDateString(a!.startDateLocal),
        })),
    };
  });
}

/** Progress for the user's current week, reconciling first. */
export async function currentWeekProgress(userId: string): Promise<GoalProgress[]> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return reconcileWeek(userId, currentWeekStart(profile?.timezone || "Europe/Berlin"));
}

/**
 * Moves an activity's credit to `goalId`, or dismisses it everywhere when
 * `goalId` is null. Dismissal is recorded rather than deleted so the reconciler
 * doesn't simply re-credit it.
 */
export async function resolveCredit(
  userId: string,
  activityId: string,
  goalId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, userId },
    select: { id: true, startDateLocal: true },
  });
  if (!activity) return { ok: false, error: "No activity with that id for this user." };

  const weekStart = weekStartOf(wallDateString(activity.startDateLocal));
  const goals = await prisma.weeklyGoal.findMany({ where: { userId, weekStart } });
  if (goals.length === 0) return { ok: false, error: "No weekly goals in that activity's week." };

  if (goalId && !goals.some((g) => g.id === goalId)) {
    return { ok: false, error: "That goal id is not one of this week's goals." };
  }

  // Mark every existing credit for this activity as decided-and-rejected, then
  // write the chosen one as confirmed.
  await prisma.weeklyGoalCredit.updateMany({
    where: { activityId, goalId: { in: goals.map((g) => g.id) } },
    data: { dismissed: true, provisional: false },
  });

  if (goalId) {
    await prisma.weeklyGoalCredit.upsert({
      where: { goalId_activityId: { goalId, activityId } },
      create: { goalId, activityId, provisional: false, dismissed: false },
      update: { dismissed: false, provisional: false },
    });
  }
  return { ok: true };
}

/**
 * One line per flexible weekly goal, for the bespoke prompts used by the daily
 * opener and the morning briefing. Those build their own context rather than
 * going through buildCoachContext, so without this the coach cannot chase a
 * shortfall in the two places we decided it should.
 */
export async function renderWeeklyGoalsLine(userId: string, timezone: string): Promise<string> {
  const weekStart = currentWeekStart(timezone);
  const goals = await reconcileWeek(userId, weekStart);
  if (goals.length === 0) return "";

  const todayStr = todayInTimezone(timezone);
  const weekEnd = wallDateString(addDaysWall(weekStart, 6));
  const daysLeft = Math.max(
    0,
    Math.round((parseWall(weekEnd).getTime() - parseWall(todayStr).getTime()) / 86400000)
  );
  const parts = goals.map((g) => `${g.label} ${g.done}/${g.target}${g.met ? " ✓" : ""}`);
  return `\nWeekly goals (${daysLeft} day(s) left this week): ${parts.join(", ")}. These have no fixed day. Mention one only if it is genuinely at risk given the days remaining — never nag, and never ask them to tick anything off.`;
}
