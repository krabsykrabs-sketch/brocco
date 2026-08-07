"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "../nav";
import { categoryMeta, getWorkoutTypeColor } from "@/lib/categories";
import { useWeeklyGoals, WeeklyGoalsTracker } from "@/app/weekly-goals-tracker";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { useFeatures } from "../features-provider";
import { anyLifeFeature } from "@/lib/features";
import { isCompatibleType } from "@/lib/activity-types";

// --- Types (mirror /api/today) ---

interface EventOccurrence {
  eventId: string; occurrenceKey: string; date: string; start: string; end: string | null;
  title: string; location: string | null; notes: string | null; category: string;
  allDay: boolean; recurring: boolean; continuation: boolean;
}
interface WorkoutItem {
  workoutId: string; date: string; title: string; workoutType: string; activityType: string;
  targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null;
  description: string | null; status: string; completed: boolean;
}
interface TodoItem {
  todoId: string; title: string; notes: string | null; dueDate: string | null; dueTime: string | null;
  priority: string | null; recurrence: string; done: boolean; listId: string | null;
  listName: string | null; parentId: string | null; overdue: boolean;
}
interface ActivityRow {
  id: string; name: string; activityType: string; distanceKm: number | null;
  avgPacePerKm: string | null; avgHeartRate: number | null; durationMin: number | null;
}
interface TodayData {
  date: string; userName: string;
  events: EventOccurrence[]; workouts: WorkoutItem[]; todos: TodoItem[]; activities: ActivityRow[];
  upcoming: { events: EventOccurrence[]; workouts: WorkoutItem[] };
  weekSummary: {
    runKm: number; plannedKm: number; completedSessions: number; totalSessions: number;
    weekNumber: number | null; totalWeeks: number; phaseName: string | null;
    weekStart: string; weekEnd: string;
  };
  hasActivePlan: boolean; planExpired: boolean; activePlanName: string | null;
  stravaConnected: boolean; activityCount: number;
}

function timeOf(e: EventOccurrence): string {
  return e.allDay ? "" : e.start.slice(11, 16);
}

function formatHeaderDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function activityDetail(a: ActivityRow): string {
  return [
    a.distanceKm ? `${a.distanceKm.toFixed(1)} km` : null,
    a.avgPacePerKm,
    !a.distanceKm && a.durationMin ? `${Math.round(a.durationMin)} min` : null,
  ].filter(Boolean).join(" · ");
}

// --- Agenda rows ---

function EventRow({ event }: { event: EventOccurrence }) {
  const meta = categoryMeta(event.category);
  const isLastDay = event.end?.slice(0, 10) === event.date;
  return (
    <div className={`flex items-center gap-3 border-2 rounded-xl px-3.5 py-2.5 shadow-[2px_2px_0_var(--color-shade)] ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-12 flex-shrink-0 text-right">
        {event.continuation ? (
          <span className="text-sm text-moss" title="Continues from an earlier day">⟶</span>
        ) : event.allDay ? (
          <span className="text-[10px] uppercase font-extrabold text-moss">{event.category === "birthday" ? "🎂" : "all day"}</span>
        ) : (
          <span className="text-sm font-extrabold text-ink tabular-nums">{timeOf(event)}</span>
        )}
      </div>
      <div className="w-1.5 self-stretch rounded-full border border-ink/60" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink truncate">{event.title}</p>
        <p className="text-xs text-moss font-semibold truncate">
          {event.continuation
            ? isLastDay && !event.allDay
              ? `ends ${event.end!.slice(11, 16)}`
              : "continues all day"
            : !event.allDay && event.end
            ? `until ${event.end.slice(11, 16)}`
            : ""}
          {event.location ? `${event.continuation || (!event.allDay && event.end) ? " · " : ""}${event.location}` : ""}
        </p>
      </div>
      {event.recurring && <span className="text-xs text-sage" title="Recurring">↻</span>}
    </div>
  );
}

/**
 * Planned | actual, side by side: the plan on the left, what actually
 * happened on the right — real distance/pace instead of a tiny badge.
 */
function WorkoutRow({ workout, matched }: { workout: WorkoutItem; matched: ActivityRow | null }) {
  if (workout.workoutType === "rest") {
    return (
      <div className="flex items-center gap-3 bg-ghost border-2 border-ink/20 rounded-xl px-3.5 py-2.5">
        <div className="w-12 flex-shrink-0 text-right"><span className="text-sm">💤</span></div>
        <p className="text-sm text-moss font-semibold">Rest day — recovery is training too.</p>
      </div>
    );
  }

  const done = workout.completed || !!matched;
  const details = [
    workout.targetDistanceKm ? `${workout.targetDistanceKm} km` : null,
    workout.targetPace,
    workout.targetDurationMin ? `${workout.targetDurationMin} min` : null,
  ].filter(Boolean).join(" · ");

  // Strength sessions are playable: deep-link into the guided workout timer
  const isStrength = workout.workoutType === "strength" || workout.activityType === "strength";
  const href = isStrength && !done ? `/workout?planned=${workout.workoutId}` : matched ? `/activity/${matched.id}` : `/plan?w=${workout.workoutId}`;

  return (
    <Link href={href} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-3.5 py-2.5 border-r-2 border-dashed border-shade min-w-0">
        <p className="label-xs mb-0.5">Planned</p>
        <p className="text-sm font-bold text-ink truncate flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          {workout.title}
        </p>
        <p className="text-xs text-moss font-semibold truncate tabular-nums">{details || (isStrength ? "guided session" : "training plan")}</p>
      </div>
      {done ? (
        <div className="px-3.5 py-2.5 bg-sprout min-w-0">
          <p className="label-xs mb-0.5 text-leaf!">✓ Done</p>
          <p className="text-sm font-extrabold text-ink truncate tabular-nums">{matched ? activityDetail(matched) || matched.name : "completed"}</p>
          {matched?.avgHeartRate && <p className="text-xs text-leaf font-bold tabular-nums">{Math.round(matched.avgHeartRate)} bpm</p>}
        </div>
      ) : (
        <div className="px-3.5 py-2.5 bg-ghost min-w-0 flex flex-col justify-center">
          {isStrength ? (
            <span className="btn-brocco self-start px-3 py-1.5 text-xs">Start ▶</span>
          ) : (
            <>
              <p className="label-xs mb-0.5">Actual</p>
              <p className="text-sm font-bold text-ghost-ink">— not yet run</p>
            </>
          )}
        </div>
      )}
    </Link>
  );
}

/** A completed activity with no planned workout behind it. */
function ExtraActivityRow({ activity }: { activity: ActivityRow }) {
  return (
    <Link href={`/activity/${activity.id}`} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-3.5 py-2.5 border-r-2 border-dashed border-shade bg-ghost min-w-0">
        <p className="label-xs mb-0.5">Unplanned</p>
        <p className="text-sm font-bold text-ghost-ink">— spontaneous</p>
      </div>
      <div className="px-3.5 py-2.5 bg-sprout min-w-0">
        <p className="label-xs mb-0.5 text-leaf!">✓ Done</p>
        <p className="text-sm font-extrabold text-ink truncate">{activity.name}</p>
        <p className="text-xs text-leaf font-bold truncate tabular-nums">{activityDetail(activity)}</p>
      </div>
    </Link>
  );
}

function TaskRow({ task, onToggle }: { task: TodoItem; onToggle: (t: TodoItem) => void }) {
  const prioColor = task.priority === "high" ? "text-clay" : task.priority === "medium" ? "text-sun" : "";
  return (
    <div className="flex items-center gap-3 sticker px-3.5 py-2.5">
      <div className="w-12 flex-shrink-0 text-right">
        {task.dueTime ? <span className="text-sm font-extrabold text-ink tabular-nums">{task.dueTime}</span> : <span className="text-sm text-sage">☐</span>}
      </div>
      <button
        onClick={() => onToggle(task)}
        className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          task.done ? "bg-brocco border-ink" : "border-ink bg-card hover:bg-sprout"
        }`}
        aria-label={task.done ? "Mark not done" : "Mark done"}
      >
        {task.done && <span className="text-ink text-xs font-bold leading-none">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold truncate ${task.done ? "text-sage line-through" : "text-ink"}`}>
          {task.title}
          {task.priority && <span className={`ml-1.5 text-xs ${prioColor}`}>{task.priority === "high" ? "!!" : "!"}</span>}
        </p>
        <p className="text-xs truncate font-semibold">
          {task.overdue && <span className="text-clay">overdue · {task.dueDate} </span>}
          {task.listName && <span className="text-sage">{task.listName}</span>}
          {task.recurrence !== "none" && <span className="text-sage"> ↻</span>}
        </p>
      </div>
    </div>
  );
}

// --- Weekly review card (collapsed to a teaser row until tapped) ---

function WeeklyReviewCard() {
  const [review, setReview] = useState<{ text: string; weekStart: string } | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until checked
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/weekly-review")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.available || !d.review) return;
        const dismissedWeek = localStorage.getItem("brocco_review_dismissed");
        setDismissed(dismissedWeek === d.weekStart);
        setReview({ text: d.review, weekStart: d.weekStart });
      })
      .catch(() => {});
  }, []);

  if (!review || dismissed) return null;

  return (
    <section className="mb-3">
      <div className="sticker bg-sprout px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
            <p className="label-xs text-leaf!">📋 Your week in review</p>
            <span className={`text-leaf text-xs transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          </button>
          <button
            onClick={() => {
              localStorage.setItem("brocco_review_dismissed", review.weekStart);
              setDismissed(true);
            }}
            className="text-moss hover:text-ink leading-none"
            aria-label="Dismiss weekly review"
          >
            &times;
          </button>
        </div>
        {open && (
          <p className="text-sm text-ink font-semibold leading-relaxed whitespace-pre-wrap mt-2">{review.text}</p>
        )}
      </div>
    </section>
  );
}

// --- Morning briefing (clamped to two lines until expanded) ---

function BriefingCard({ briefing, loading }: { briefing: string | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const text = briefing || "Have a good one. Open the chat if you want to talk anything through.";
  const isLong = text.length > 120;

  return (
    <section className="mb-4">
      <div className="sticker-lg bg-[#eef6d4] px-4 py-3 flex gap-3 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-64.png" alt="" className="w-7 h-7 flex-shrink-0 rounded-full border-2 border-ink" />
        {loading ? (
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 bg-shade/60 rounded animate-pulse w-full" />
            <div className="h-3 bg-shade/60 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <p className={`text-sm text-ink font-semibold leading-relaxed ${!expanded && isLong ? "line-clamp-2" : ""}`}>
              {text}
            </p>
            {isLong && (
              <button onClick={() => setExpanded((e) => !e)} className="text-xs text-leaf font-bold mt-0.5">
                {expanded ? "less" : "more"}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Week summary ---

function WeekCard({ data }: { data: TodayData }) {
  const ws = data.weekSummary;
  if (!data.hasActivePlan || (ws.plannedKm === 0 && ws.runKm === 0)) return null;
  const pct = ws.plannedKm > 0 ? Math.min((ws.runKm / ws.plannedKm) * 100, 150) : 0;
  return (
    <Link href="/plan" className="sticker-lg sticker-press block px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="label-xs">
          This week{ws.weekNumber ? ` · W${ws.weekNumber}${ws.totalWeeks ? `/${ws.totalWeeks}` : ""}` : ""}{ws.phaseName ? ` · ${ws.phaseName}` : ""}
        </p>
        {ws.totalSessions > 0 && (
          <p className="text-[10px] text-sage font-bold">{ws.completedSessions}/{ws.totalSessions} sessions</p>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm text-ink tabular-nums">
          <span className="font-extrabold text-lg">{ws.runKm.toFixed(1)}</span>
          {ws.plannedKm > 0 && <span className="text-sage font-bold"> / {ws.plannedKm.toFixed(0)} km</span>}
        </p>
        {ws.plannedKm > 0 && (
          <span className={`text-xs font-extrabold tabular-nums ${pct >= 100 ? "text-leaf" : "text-sage"}`}>{Math.round(pct)}%</span>
        )}
      </div>
      {ws.plannedKm > 0 && (
        <div className="h-2.5 bg-ghost border-2 border-ink rounded-full overflow-hidden">
          <div className="h-full bg-brocco transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </Link>
  );
}

// --- Main ---

export default function TodayView() {
  const features = useFeatures();
  const goals = useWeeklyGoals();
  const [data, setData] = useState<TodayData | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    fetch("/api/today")
      .then((r) => {
        if (!r.ok) throw new Error(`today fetch failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(() => {}) // keeps previous data on refetch failure; initial failure -> error state below
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/briefing").then((r) => r.json()).then((d) => setBriefing(d.briefing || null)).catch(() => {}).finally(() => setBriefingLoading(false));
    // Weekly outline→detailed promotion (moved from the old dashboard)
    const lastPromo = localStorage.getItem("brocco_last_promo");
    const today = new Date().toISOString().slice(0, 10);
    if (!lastPromo || lastPromo < today) {
      fetch("/api/plan/promote", { method: "POST" }).then(() => localStorage.setItem("brocco_last_promo", today)).catch(() => {});
    }
  }, [fetchData]);

  useScreenContext(
    { name: "today", rangeStart: data?.date, rangeEnd: data?.date },
    [data?.date]
  );
  useDataChanged(["calendar", "tasks", "plan", "activities", "health"], fetchData);

  async function handleToggleTask(task: TodoItem) {
    if (!data) return;
    const newDone = !task.done;
    setData({
      ...data,
      todos: data.todos.map((t) => (t.todoId === task.todoId ? { ...t, done: newDone } : t)),
    });
    try {
      const res = await fetch(`/api/tasks/${task.todoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: newDone }),
      });
      if (!res.ok) throw new Error();
      if (task.recurrence !== "none") fetchData(); // next occurrence may appear
    } catch {
      // Roll back the optimistic toggle (offline PWA, expired session, ...)
      setData((prev) =>
        prev
          ? { ...prev, todos: prev.todos.map((t) => (t.todoId === task.todoId ? { ...t, done: task.done } : t)) }
          : prev
      );
    }
  }

  if (loading || !data) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4">
        <PageHeader title="Today" />
        <div className="text-moss text-center py-12 font-semibold">{loading ? "Loading..." : "Failed to load."}</div>
      </main>
    );
  }

  // Sort agenda: all-day events + birthdays + multi-day continuations →
  // timed items (events/tasks with time) by time → workout → undated tasks.
  // Continuations sort with all-day items — their start time belongs to a
  // previous day and would mis-position them in today's timeline.
  const allDayEvents = data.events.filter((e) => e.allDay || e.continuation);
  const timedEvents = data.events.filter((e) => !e.allDay && !e.continuation);
  const openTodos = data.todos.filter((t) => !t.done || t.dueDate === data.date);
  const timedTodos = openTodos.filter((t) => t.dueTime);
  const untimedTodos = openTodos.filter((t) => !t.dueTime);

  const timedRows: Array<{ key: string; time: string; node: React.ReactNode }> = [
    ...timedEvents.map((e) => ({ key: e.occurrenceKey, time: timeOf(e), node: <EventRow key={e.occurrenceKey} event={e} /> })),
    ...timedTodos.map((t) => ({ key: t.todoId, time: t.dueTime!, node: <TaskRow key={t.todoId} task={t} onToggle={handleToggleTask} /> })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  // Planned ↔ done reconciliation (same rule as calendar): each non-rest
  // workout claims the first compatible unused activity; leftovers render
  // as unplanned side-by-side rows.
  const usedActivities = new Set<string>();
  const workoutRows = data.workouts.map((w) => {
    if (w.workoutType === "rest") return { workout: w, matched: null };
    const matched =
      data.activities.find((a) => !usedActivities.has(a.id) && isCompatibleType(w.activityType, a.activityType)) || null;
    if (matched) usedActivities.add(matched.id);
    return { workout: w, matched };
  });
  const extraActivities = data.activities.filter((a) => !usedActivities.has(a.id));
  const visibleWorkoutRows = workoutRows.filter(
    ({ workout }) => workout.workoutType !== "rest" || (data.workouts.length === 1 && extraActivities.length === 0)
  );

  const isEmptyDay =
    allDayEvents.length === 0 && timedRows.length === 0 && visibleWorkoutRows.length === 0 &&
    extraActivities.length === 0 && untimedTodos.length === 0;
  const showNewUserCTAs = !data.hasActivePlan && !data.planExpired;

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title="Today" />

      {/* Date + greeting */}
      <div className="mt-3 mb-3">
        <h1 className="text-xl font-extrabold text-ink">{formatHeaderDate(data.date)}</h1>
      </div>

      {/* Morning briefing */}
      <BriefingCard briefing={briefing} loading={briefingLoading} />

      {/* Weekly review (Sunday evening / Monday only) */}
      <WeeklyReviewCard />

      {/* Plan expired prompt */}
      {data.planExpired && (
        <div className="mb-3 sticker px-3.5 py-3 flex items-center gap-3">
          <span className="text-xl flex-shrink-0">🏁</span>
          <p className="text-sm text-ink font-bold flex-1">{data.activePlanName || "Your plan"} is done!</p>
          <Link href={`/chat?msg=${encodeURIComponent("I'd like to build a new training plan")}`} className="btn-brocco px-3 py-1.5 text-xs flex-shrink-0">Build a plan</Link>
        </div>
      )}


      {/* New user CTAs (compact — life features work regardless) */}
      {/* New-user CTAs. Strava leads while it's disconnected — Brocco learns
          far more from a real history than from interview answers, so the
          plan CTA steps back to secondary until it's linked. */}
      {showNewUserCTAs && (
        <div className="mb-4 space-y-2">
          {!data.stravaConnected ? (
            <>
              <Link href="/api/strava/auth?returnTo=/today" className="btn-brocco flex items-center gap-3 px-4 py-3">
                <span className="text-lg">🏃</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-extrabold">Connect Strava first</p>
                  <p className="text-xs text-leaf font-bold">Brocco reads your history and builds the plan around it</p>
                </div>
              </Link>
              <Link href={`/chat?msg=${encodeURIComponent("I'd like to build a training plan")}`} className="sticker sticker-press flex items-center gap-3 px-4 py-3">
                <span className="text-lg">💬</span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink">Or build a plan without it</p>
                  <p className="text-xs text-moss font-semibold">Brocco will ask you a few questions instead</p>
                </div>
              </Link>
            </>
          ) : (
            <Link href={`/chat?msg=${encodeURIComponent("I'd like to build a training plan")}`} className="btn-brocco flex items-center gap-3 px-4 py-3">
              <span className="text-lg">💬</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-extrabold">Build my training plan</p>
                <p className="text-xs text-leaf font-bold">Chat with Brocco to create one</p>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Agenda */}
      <section className="space-y-2 mb-4">
        {allDayEvents.map((e) => <EventRow key={e.occurrenceKey} event={e} />)}
        {timedRows.map((r) => r.node)}
        {visibleWorkoutRows.map(({ workout, matched }) => (
          <WorkoutRow key={workout.workoutId} workout={workout} matched={matched} />
        ))}
        {extraActivities.map((a) => <ExtraActivityRow key={a.id} activity={a} />)}
        {untimedTodos.map((t) => <TaskRow key={t.todoId} task={t} onToggle={handleToggleTask} />)}

        {isEmptyDay && (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">🌤️</p>
            <p className="text-ink text-sm font-bold">
              {anyLifeFeature(features) ? "Clear day ahead" : "No training today"}
            </p>
            <p className="text-moss text-xs mt-1 font-semibold">
              {anyLifeFeature(features)
                ? "Nothing scheduled. Ask Brocco if you want to add something."
                : "Rest up, or chat with Brocco about the week."}
            </p>
          </div>
        )}
      </section>

      {/* Week summary — the "am I on track this week" half of this tab */}
      <section className="mb-4 space-y-2">
        <WeekCard data={data} />
        <WeeklyGoalsTracker goals={goals} />
      </section>

      {/* Ask Brocco */}
      <section>
        <Link href="/chat" className="btn-quiet flex items-center justify-center gap-2 w-full py-2.5 text-sm">
          <span>💬</span><span>Open chat with Brocco</span>
        </Link>
      </section>
    </main>
  );
}
