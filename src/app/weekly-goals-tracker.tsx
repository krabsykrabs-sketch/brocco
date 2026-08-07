"use client";

import { useEffect, useState } from "react";

/**
 * "3 of 4 this week" — the visible half of flexible weekly goals.
 *
 * Progress is counted from real activities, so this is a readout, not a
 * checklist: there is deliberately nothing to tick. Renders nothing at all when
 * no goals are set, so it never occupies space on an account that doesn't use
 * the feature.
 */

export interface GoalProgress {
  id: string;
  label: string;
  category: string;
  target: number;
  done: number;
  met: boolean;
  autoTracked: boolean;
  provisional: { activityId: string; name: string; date: string }[];
}

export function useWeeklyGoals() {
  const [goals, setGoals] = useState<GoalProgress[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/goals")
      .then((r) => (r.ok ? r.json() : { goals: [] }))
      .then((d) => { if (!cancelled) setGoals(d.goals || []); })
      .catch(() => { if (!cancelled) setGoals([]); });
    return () => { cancelled = true; };
  }, []);

  return goals;
}

function Pips({ done, target, met }: { done: number; target: number; met: boolean }) {
  // Pips read faster than a bar at these counts — you can see "one to go"
  // without reading the numbers.
  const pips = Array.from({ length: Math.max(target, done) });
  return (
    <span className="flex gap-1 flex-shrink-0" aria-hidden>
      {pips.map((_, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full border-2 ${
            i < done
              ? met ? "bg-brocco border-ink" : "bg-leaf border-ink"
              : "bg-transparent border-shade"
          }`}
        />
      ))}
    </span>
  );
}

export function GoalRow({ goal }: { goal: GoalProgress }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs font-bold text-ink truncate flex-1 min-w-0">{goal.label}</span>
      <Pips done={goal.done} target={goal.target} met={goal.met} />
      <span
        className={`text-xs font-extrabold tabular-nums flex-shrink-0 ${
          goal.met ? "text-leaf" : "text-moss"
        }`}
      >
        {goal.done}/{goal.target}
      </span>
    </div>
  );
}

/**
 * @param variant "card" stands alone (Today); "bare" drops the frame so it can
 *                sit inside an existing panel (Plan).
 */
export function WeeklyGoalsTracker({
  goals,
  variant = "card",
  title = "This week",
}: {
  goals: GoalProgress[] | null;
  variant?: "card" | "bare";
  title?: string;
}) {
  if (!goals || goals.length === 0) return null;

  const body = (
    <div className="space-y-1.5">
      {goals.map((g) => (
        <GoalRow key={g.id} goal={g} />
      ))}
    </div>
  );

  if (variant === "bare") return body;

  return (
    <section className="sticker px-3 py-2.5">
      <h2 className="label-xs mb-2">{title}</h2>
      {body}
    </section>
  );
}
