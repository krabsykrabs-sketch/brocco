"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "../nav";
import { categoryMeta, getWorkoutTypeColor } from "@/lib/categories";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { useFeatures } from "../features-provider";
import { anyLifeFeature } from "@/lib/features";
import { MOOD_EMOJI, MOOD_LABELS } from "@/lib/journal";

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
interface PlanAdjustment { id: string; summary: string; }

function timeOf(e: EventOccurrence): string {
  return e.allDay ? "" : e.start.slice(11, 16);
}

function formatHeaderDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// --- Agenda rows ---

function EventRow({ event }: { event: EventOccurrence }) {
  const meta = categoryMeta(event.category);
  const isLastDay = event.end?.slice(0, 10) === event.date;
  return (
    <div className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-12 flex-shrink-0 text-right">
        {event.continuation ? (
          <span className="text-sm text-gray-500" title="Continues from an earlier day">⟶</span>
        ) : event.allDay ? (
          <span className="text-[10px] uppercase font-bold text-gray-500">{event.category === "birthday" ? "🎂" : "all day"}</span>
        ) : (
          <span className="text-sm font-semibold text-gray-200">{timeOf(event)}</span>
        )}
      </div>
      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100 truncate">{event.title}</p>
        <p className="text-xs text-gray-500 truncate">
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
      {event.recurring && <span className="text-xs text-gray-600" title="Recurring">↻</span>}
    </div>
  );
}

function WorkoutRow({ workout, activities }: { workout: WorkoutItem; activities: ActivityRow[] }) {
  if (workout.workoutType === "rest" && activities.length === 0) {
    return (
      <div className="flex items-center gap-3 bg-gray-900/40 border border-gray-800/40 rounded-xl px-3.5 py-2.5">
        <div className="w-12 flex-shrink-0 text-right"><span className="text-sm">💤</span></div>
        <div className="w-1 self-stretch rounded-full bg-gray-700" />
        <p className="text-sm text-gray-500">Rest day — recovery is training too.</p>
      </div>
    );
  }
  if (workout.workoutType === "rest") return null;

  const details = [
    workout.targetDistanceKm ? `${workout.targetDistanceKm}km` : null,
    workout.targetPace,
    workout.targetDurationMin ? `${workout.targetDurationMin}min` : null,
  ].filter(Boolean).join(" · ");

  // Strength sessions are playable: deep-link into the guided workout timer
  const isStrength = workout.workoutType === "strength" || workout.activityType === "strength";
  if (isStrength) {
    return (
      <Link
        href={workout.completed ? "/plan" : `/workout?planned=${workout.workoutId}`}
        className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 transition-colors ${
          workout.completed
            ? "bg-green-900/25 border-green-700/40"
            : "bg-gray-900 border-gray-700/60 hover:border-gray-600"
        }`}
      >
        <div className="w-12 flex-shrink-0 text-right">
          <span className="text-sm">{workout.completed ? "✅" : "💪"}</span>
        </div>
        <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-medium truncate ${workout.completed ? "text-green-300" : "text-gray-100"}`}>{workout.title}</p>
            <span className="text-[9px] uppercase font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">plan</span>
          </div>
          <p className="text-xs text-gray-500 truncate">{details || "guided session"}</p>
        </div>
        {!workout.completed && (
          <span className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg flex-shrink-0">Start ▶</span>
        )}
      </Link>
    );
  }

  return (
    <Link href="/plan" className={`flex items-center gap-3 border rounded-xl px-3.5 py-2.5 transition-colors ${
      workout.completed
        ? "bg-green-900/25 border-green-700/40"
        : "bg-gray-900 border-gray-700/60 hover:border-gray-600"
    }`}>
      <div className="w-12 flex-shrink-0 text-right">
        <span className="text-sm">{workout.completed ? "✅" : "🏃"}</span>
      </div>
      <div className="w-1 self-stretch rounded-full" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-medium truncate ${workout.completed ? "text-green-300" : "text-gray-100"}`}>{workout.title}</p>
          <span className="text-[9px] uppercase font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">plan</span>
        </div>
        {details && <p className="text-xs text-gray-500 truncate">{details}</p>}
      </div>
      <span className="text-gray-600 text-sm">&rsaquo;</span>
    </Link>
  );
}

function TaskRow({ task, onToggle }: { task: TodoItem; onToggle: (t: TodoItem) => void }) {
  const prioColor = task.priority === "high" ? "text-red-400" : task.priority === "medium" ? "text-amber-400" : "";
  return (
    <div className="flex items-center gap-3 bg-gray-900/70 border border-gray-800/60 rounded-xl px-3.5 py-2.5">
      <div className="w-12 flex-shrink-0 text-right">
        {task.dueTime ? <span className="text-sm font-semibold text-gray-300">{task.dueTime}</span> : <span className="text-sm text-gray-600">☐</span>}
      </div>
      <button
        onClick={() => onToggle(task)}
        className={`w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          task.done ? "bg-green-600 border-green-600" : "border-gray-600 hover:border-green-500"
        }`}
        aria-label={task.done ? "Mark not done" : "Mark done"}
      >
        {task.done && <span className="text-white text-xs leading-none">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${task.done ? "text-gray-500 line-through" : "text-gray-100"}`}>
          {task.title}
          {task.priority && <span className={`ml-1.5 text-xs ${prioColor}`}>{task.priority === "high" ? "!!" : "!"}</span>}
        </p>
        <p className="text-xs truncate">
          {task.overdue && <span className="text-red-400/90 font-medium">overdue · {task.dueDate} </span>}
          {task.listName && <span className="text-gray-600">{task.listName}</span>}
          {task.recurrence !== "none" && <span className="text-gray-600"> ↻</span>}
        </p>
      </div>
    </div>
  );
}

// --- Mood check-in (one tap, no typing required, dismissible per day) ---

function MoodCheckInCard() {
  const [state, setState] = useState<"hidden" | "prompt" | "saving" | "saved">("hidden");
  const [savedMood, setSavedMood] = useState<number | null>(null);
  const [day, setDay] = useState("");

  useEffect(() => {
    fetch("/api/journal?limit=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setDay(d.today || "");
        const dismissed = localStorage.getItem("brocco_mood_dismissed") === d.today;
        if (!d.moodToday && !dismissed) setState("prompt");
      })
      .catch(() => {});
  }, []);

  async function logMood(mood: number) {
    setState("saving");
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mood }),
      });
      if (!res.ok) throw new Error();
      setSavedMood(mood);
      setState("saved");
    } catch {
      setState("prompt");
    }
  }

  if (state === "hidden") return null;

  return (
    <section className="mb-4" data-testid="mood-checkin">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3">
        {state === "saved" ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-gray-300">
              Logged {MOOD_EMOJI[savedMood!]} — thanks for checking in.
            </p>
            <Link href="/journal" className="text-xs text-green-400 hover:text-green-300 flex-shrink-0">
              Add a note ›
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-300">How are you feeling today?</p>
              <button
                onClick={() => {
                  localStorage.setItem("brocco_mood_dismissed", day);
                  setState("hidden");
                }}
                className="text-gray-600 hover:text-gray-300 leading-none"
                aria-label="Dismiss mood check-in"
              >
                &times;
              </button>
            </div>
            <div className="flex justify-between gap-1">
              {[1, 2, 3, 4, 5].map((m) => (
                <button
                  key={m}
                  onClick={() => logMood(m)}
                  disabled={state === "saving"}
                  aria-label={MOOD_LABELS[m]}
                  className="flex-1 py-1.5 text-2xl rounded-xl hover:bg-gray-800 active:scale-110 transition-all disabled:opacity-40"
                >
                  {MOOD_EMOJI[m]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// --- Weekly review card (Sunday evening / Monday) ---

function WeeklyReviewCard() {
  const [review, setReview] = useState<{ text: string; weekStart: string } | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until checked

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
    <section className="mb-4">
      <div className="bg-gradient-to-br from-emerald-900/30 to-gray-900 border border-emerald-800/40 rounded-2xl px-4 py-3.5">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <p className="text-[10px] font-bold text-emerald-400/80 uppercase tracking-widest">
            📋 Your week in review
          </p>
          <button
            onClick={() => {
              localStorage.setItem("brocco_review_dismissed", review.weekStart);
              setDismissed(true);
            }}
            className="text-gray-600 hover:text-gray-300 leading-none"
            aria-label="Dismiss weekly review"
          >
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{review.text}</p>
      </div>
    </section>
  );
}

// --- Week summary (salvaged compact version of the old dashboard card) ---

function WeekCard({ data }: { data: TodayData }) {
  const ws = data.weekSummary;
  if (!data.hasActivePlan || (ws.plannedKm === 0 && ws.runKm === 0)) return null;
  const pct = ws.plannedKm > 0 ? Math.min((ws.runKm / ws.plannedKm) * 100, 150) : 0;
  return (
    <Link href="/plan" className="block rounded-xl bg-slate-800/80 border border-slate-700 px-4 py-3 hover:border-slate-600 transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          This week{ws.weekNumber ? ` · W${ws.weekNumber}${ws.totalWeeks ? `/${ws.totalWeeks}` : ""}` : ""}{ws.phaseName ? ` · ${ws.phaseName}` : ""}
        </p>
        {ws.totalSessions > 0 && (
          <p className="text-[10px] text-slate-500">{ws.completedSessions}/{ws.totalSessions} sessions</p>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-white">{ws.runKm.toFixed(1)}</span>
          {ws.plannedKm > 0 && <span className="text-slate-500"> / {ws.plannedKm.toFixed(0)} km</span>}
        </p>
        {ws.plannedKm > 0 && (
          <span className={`text-xs font-medium ${pct >= 100 ? "text-green-400" : "text-slate-500"}`}>{Math.round(pct)}%</span>
        )}
      </div>
      {ws.plannedKm > 0 && (
        <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
          <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </Link>
  );
}

// --- Main ---

export default function TodayView() {
  const features = useFeatures();
  const [data, setData] = useState<TodayData | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [adjustments, setAdjustments] = useState<PlanAdjustment[]>([]);
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
    fetch("/api/plan/adjustments").then((r) => r.json()).then((d) => setAdjustments(d.adjustments || [])).catch(() => {});
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

  async function handleUndoAdjustment(id: string) {
    const res = await fetch("/api/plan/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) setAdjustments((prev) => prev.filter((a) => a.id !== id));
  }

  if (loading || !data) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4">
        <PageHeader title="Today" />
        <div className="text-gray-500 text-center py-12">{loading ? "Loading..." : "Failed to load."}</div>
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

  const isEmptyDay =
    allDayEvents.length === 0 && timedRows.length === 0 && data.workouts.length === 0 && untimedTodos.length === 0;
  const showNewUserCTAs = !data.hasActivePlan && !data.planExpired;

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title="Today" />

      {/* Date + greeting */}
      <div className="mt-3 mb-3">
        <h1 className="text-xl font-bold text-white">{formatHeaderDate(data.date)}</h1>
      </div>

      {/* Morning briefing */}
      <section className="mb-4">
        <div className="bg-green-900/15 border border-green-800/30 rounded-2xl px-4 py-3.5 flex gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="" className="w-7 h-7 flex-shrink-0" />
          {briefingLoading ? (
            <div className="flex-1 space-y-2 py-1">
              <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
              <div className="h-3 bg-gray-800 rounded animate-pulse w-2/3" />
            </div>
          ) : (
            <p className="text-sm text-gray-200 leading-relaxed">{briefing || "Have a good one. Speak into the mic to add anything to your day."}</p>
          )}
        </div>
      </section>

      {/* Mood check-in (journal feature) */}
      {features.journal && <MoodCheckInCard />}

      {/* Weekly review (Sunday evening / Monday only) */}
      <WeeklyReviewCard />

      {/* Plan expired prompt */}
      {data.planExpired && (
        <div className="mb-3 bg-green-900/20 border border-green-800/40 rounded-xl p-3.5 flex items-center gap-3">
          <span className="text-xl flex-shrink-0">🏁</span>
          <p className="text-sm text-gray-200 flex-1">{data.activePlanName || "Your plan"} is done!</p>
          <Link href={`/chat?msg=${encodeURIComponent("I'd like to build a new training plan")}`} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg flex-shrink-0">Build a plan</Link>
        </div>
      )}

      {/* Auto-adjustments with undo */}
      {adjustments.length > 0 && (
        <div className="mb-3 space-y-1">
          {adjustments.map((a) => (
            <div key={a.id} className="bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <p className="text-xs text-gray-300 truncate flex-1">{a.summary}</p>
              <button onClick={() => handleUndoAdjustment(a.id)} className="text-xs text-gray-500 hover:text-yellow-400 ml-2 flex-shrink-0">Undo</button>
            </div>
          ))}
        </div>
      )}

      {/* New user CTAs (compact — life features work regardless) */}
      {showNewUserCTAs && (
        <div className="mb-4 space-y-2">
          {!data.stravaConnected && (
            <Link href="/api/strava/auth?returnTo=/today" className="flex items-center gap-3 bg-gray-900 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3 transition-colors">
              <span className="text-lg">🏃</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-white">Connect Strava</p>
                <p className="text-xs text-gray-500">Import your runs so Brocco knows your fitness</p>
              </div>
            </Link>
          )}
          <Link href={`/chat?msg=${encodeURIComponent("I'd like to build a training plan")}`} className="flex items-center gap-3 bg-green-600/90 hover:bg-green-600 border border-green-500/30 rounded-xl px-4 py-3 transition-colors">
            <span className="text-lg">💬</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-white">Build my training plan</p>
              <p className="text-xs text-green-200/70">Chat with Brocco to create one</p>
            </div>
          </Link>
        </div>
      )}

      {/* Agenda */}
      <section className="space-y-1.5 mb-4">
        {allDayEvents.map((e) => <EventRow key={e.occurrenceKey} event={e} />)}
        {timedRows.map((r) => r.node)}
        {data.workouts.map((w) => (
          <WorkoutRow key={w.workoutId} workout={w} activities={data.activities} />
        ))}
        {untimedTodos.map((t) => <TaskRow key={t.todoId} task={t} onToggle={handleToggleTask} />)}

        {/* Unplanned activities done today */}
        {data.activities.length > 0 && data.workouts.every((w) => w.workoutType === "rest" || !w.completed) && (
          data.activities.map((a) => (
            <Link key={a.id} href={`/activity/${a.id}`} className="flex items-center gap-3 bg-green-900/15 border border-green-800/25 rounded-xl px-3.5 py-2.5">
              <div className="w-12 flex-shrink-0 text-right"><span className="text-sm">✅</span></div>
              <div className="w-1 self-stretch rounded-full bg-green-700" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-green-300 font-medium truncate">{a.name}</p>
                <p className="text-xs text-gray-500">{[a.distanceKm ? `${a.distanceKm.toFixed(1)}km` : null, a.avgPacePerKm].filter(Boolean).join(" · ")}</p>
              </div>
            </Link>
          ))
        )}

        {isEmptyDay && (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">🌤️</p>
            <p className="text-gray-400 text-sm font-medium">
              {anyLifeFeature(features) ? "Clear day ahead" : "No training today"}
            </p>
            <p className="text-gray-600 text-xs mt-1">
              {anyLifeFeature(features)
                ? "Tap the mic and tell Brocco what's coming up."
                : "Rest up, or chat with Brocco about the week."}
            </p>
          </div>
        )}
      </section>

      {/* Week summary */}
      <section className="mb-4">
        <WeekCard data={data} />
      </section>

      {/* Coming up */}
      {(data.upcoming.events.length > 0 || data.upcoming.workouts.length > 0) && (
        <section className="mb-4">
          <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Coming up</h2>
          <div className="space-y-1">
            {[...data.upcoming.events.map((e) => ({
                key: e.occurrenceKey, date: e.date, label: e.title,
                detail: e.allDay ? "" : e.start.slice(11, 16), color: categoryMeta(e.category).color,
              })),
              ...data.upcoming.workouts.map((w) => ({
                key: w.workoutId, date: w.date, label: w.title,
                detail: w.targetDistanceKm ? `${w.targetDistanceKm}km` : "", color: getWorkoutTypeColor(w.workoutType),
              })),
            ]
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 5)
              .map((item) => (
                <div key={item.key} className="flex items-center gap-2.5 px-1 py-1">
                  <span className="text-xs text-gray-600 w-16 flex-shrink-0">
                    {new Date(`${item.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
                  </span>
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-gray-400 truncate flex-1">{item.label}</span>
                  {item.detail && <span className="text-xs text-gray-600 flex-shrink-0">{item.detail}</span>}
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Ask Brocco */}
      <section>
        <Link href="/chat" className="flex items-center justify-center gap-2 w-full py-2.5 bg-gray-900 border border-gray-700 hover:border-gray-600 text-gray-300 text-sm font-medium rounded-xl transition-colors">
          <span>💬</span><span>Open chat with Brocco</span>
        </Link>
      </section>
    </main>
  );
}
