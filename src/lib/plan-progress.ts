import { format } from "date-fns";
import { isCompatibleType } from "@/lib/activity-types";

/**
 * Shared planned-workout ↔ activity reconciliation.
 *
 * One rule, used everywhere (plan tab, chat context, opener, calendar):
 * a planned workout counts as done when a compatible-type activity exists
 * on the same calendar day — regardless of whether that activity came from
 * Strava, was logged via chat, or was recorded by the in-app workout player.
 */

export interface MatchableActivity {
  activityType: string;
  startDateLocal: Date;
}

/** Day key convention used across the app (see /api/plan). */
export function activityDayKey(startDateLocal: Date): string {
  return format(new Date(startDateLocal), "yyyy-MM-dd");
}

export function groupActivitiesByDay<T extends MatchableActivity>(
  activities: T[]
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const a of activities) {
    const key = activityDayKey(a.startDateLocal);
    const list = map.get(key);
    if (list) list.push(a);
    else map.set(key, [a]);
  }
  return map;
}

export type WorkoutOutcome = "done" | "missed" | "skipped" | "today_pending" | "upcoming" | "rest";

export function workoutOutcome<T extends MatchableActivity>(
  workout: { dateStr: string; activityType: string; workoutType: string; status: string },
  byDay: Map<string, T[]>,
  todayStr: string
): { outcome: WorkoutOutcome; matched: T | null } {
  if (workout.workoutType === "rest") return { outcome: "rest", matched: null };

  const matched =
    byDay.get(workout.dateStr)?.find((a) => isCompatibleType(workout.activityType, a.activityType)) ??
    null;

  if (matched || workout.status === "completed") return { outcome: "done", matched };
  if (workout.status === "skipped") return { outcome: "skipped", matched: null };
  if (workout.dateStr < todayStr) return { outcome: "missed", matched: null };
  if (workout.dateStr === todayStr) return { outcome: "today_pending", matched: null };
  return { outcome: "upcoming", matched: null };
}
