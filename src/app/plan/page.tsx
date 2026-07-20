"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// --- Types ---

interface Phase { id: string; name: string; orderIndex: number; description: string | null; startWeek: number; endWeek: number; }
interface Workout { id: string; phaseId: string | null; weekNumber: number; date: string; title: string; workoutType: string; activityType: string; targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null; description: string | null; status: string; }
interface PlanWeekData { id: string; weekNumber: number; startDate: string; detailLevel: string; targetKm: number | null; targetSessions: number | null; sessionTypes: string[] | null; notes: string | null; actualKm: number | null; phaseName: string | null; }
interface WeeklyTask { id: string; weekNumber: number; description: string; category: string; status: string; }
interface DayActivity { id: string; name: string; activityType: string; distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null; avgHeartRate: number | null; source: string; }
interface Plan { id: string; name: string; goal: string | null; raceDate: string | null; startDate: string; endDate: string; status: string; phases: Phase[]; weeks: PlanWeekData[]; workouts: Workout[]; weeklyTasks: WeeklyTask[]; activitiesByDate: Record<string, DayActivity[]>; }

import { isCompatibleType, isRunning } from "@/lib/activity-types";
import { getWorkoutTypeColor } from "@/lib/categories";
import { DesktopNavLinks } from "@/app/nav";

// --- Shared Utilities ---

function getWorkoutTypeBg(type: string): string {
  switch (type) {
    case "easy": case "recovery": return "bg-sprout";
    case "tempo": return "bg-[#faeed8]";
    case "interval": return "bg-[#fae3de]";
    case "race_pace": return "bg-[#f7e4cc]";
    case "long": return "bg-[#e3eefa]";
    case "cross_training": return "bg-[#e0f2ef]";
    case "strength": return "bg-[#f0e6f8]";
    case "rest": return "bg-ghost";
    case "race": return "bg-[#faf0d0]";
    default: return "bg-ghost";
  }
}

function formatWeekRange(startDate: string): string {
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function getDayLabel(iso: string): { abbr: string; num: string } {
  const d = new Date(iso);
  return {
    abbr: d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
    num: String(d.getDate()),
  };
}

const todayStr = new Date().toISOString().split("T")[0];
function isToday(iso: string): boolean { return iso.split("T")[0] === todayStr; }
function isPastDate(iso: string): boolean { return iso.split("T")[0] < todayStr; }

// --- Task Checklist (shared) ---

function TaskChecklist({ tasks, onToggle }: { tasks: WeeklyTask[]; onToggle: (id: string, status: string) => void }) {
  if (tasks.length === 0) return null;
  const icons: Record<string, string> = { strength: "\ud83d\udcaa", mobility: "\ud83e\uddd8", nutrition: "\ud83e\udd66", recovery: "\ud83d\udca4" };
  return (
    <div className="space-y-1 mt-3">
      {tasks.map((t) => (
        <button key={t.id} onClick={() => onToggle(t.id, t.status === "done" ? "pending" : "done")} className="sticker sticker-press w-full flex items-center gap-2 px-3 py-1.5 text-left">
          <span className={`text-xs ${t.status === "done" ? "text-leaf" : "text-sage"}`}>{t.status === "done" ? "\u2611" : "\u2610"}</span>
          <span className="text-xs">{icons[t.category] || "\u2705"}</span>
          <span className={`text-xs flex-1 ${t.status === "done" ? "text-moss line-through" : "text-ink font-semibold"}`}>{t.description}</span>
        </button>
      ))}
    </div>
  );
}

// ============================
// MOBILE VIEW — Swipeable Cards
// ============================

function MobileDayRow({
  workout,
  isExpanded,
  onTap,
  dayActivities,
}: {
  workout: Workout;
  isExpanded: boolean;
  onTap: () => void;
  dayActivities: DayActivity[];
}) {
  const day = getDayLabel(workout.date);
  const isTodayRow = isToday(workout.date);
  const isPast = isPastDate(workout.date);
  const isRest = workout.workoutType === "rest";
  // Day-based completion: any compatible-type activity on this date
  const compatibleActivities = dayActivities.filter((a) => isCompatibleType(workout.activityType, a.activityType));
  const otherActivities = dayActivities.filter((a) => !isCompatibleType(workout.activityType, a.activityType));
  const isCompleted = !isRest && compatibleActivities.length > 0;
  const isMissed = isPast && !isCompleted && !isRest;
  const hasAnyActivity = dayActivities.length > 0;

  const details = [
    workout.targetDistanceKm ? `${workout.targetDistanceKm}km` : null,
    workout.targetPace,
    workout.targetDurationMin ? `${workout.targetDurationMin}min` : null,
  ].filter(Boolean).join(" \u00b7 ");

  return (
    <div
      onClick={onTap}
      className={`transition-colors cursor-pointer ${
        isTodayRow
          ? "bg-sprout/40 border-l-2 border-l-brocco"
          : isMissed
          ? "border-l-2 border-l-clay/60"
          : "border-l-2 border-l-transparent"
      } ${isMissed && !hasAnyActivity ? "opacity-60" : ""}`}
    >
      {/* Main row */}
      <div className="flex items-center px-4 py-3 gap-3">
        <div className="w-12 flex-shrink-0">
          <div className={`text-xs font-extrabold uppercase ${isTodayRow ? "text-leaf" : "text-sage"}`}>{day.abbr}</div>
          <div className={`text-lg font-extrabold leading-none ${isTodayRow ? "text-leaf" : "text-ink"}`}>{day.num}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
            <span className={`text-sm font-bold ${isCompleted ? "text-leaf" : isRest ? "text-sage" : "text-ink"}`}>
              {workout.title}
            </span>
            {isCompleted && <span className="text-xs">{"\u2705"}</span>}
            {isTodayRow && <span className="text-[9px] bg-brocco text-ink border border-ink px-1.5 py-0.5 rounded font-bold">TODAY</span>}
          </div>
          {!isRest && details && <p className="text-xs text-moss mt-0.5 truncate">{details}</p>}
        </div>
        {(!isRest || hasAnyActivity) && (
          <span className="text-xs text-sage flex-shrink-0">{isExpanded ? "\u25B2" : "\u25BC"}</span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (!isRest || hasAnyActivity) && (
        <div className="px-4 pb-3 pl-16 space-y-1.5">
          {!isRest && workout.description && (
            <p className="text-xs text-moss leading-relaxed">{workout.description}</p>
          )}
          {/* Compatible activities — green "completed" style */}
          {compatibleActivities.map((a) => (
            <Link key={a.id} href={`/activity/${a.id}`} className="block bg-sprout border-2 border-ink rounded-lg px-3 py-2 transition-colors">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-leaf">{"\u2705"}</span>
                <span className="text-ink font-bold">{a.distanceKm?.toFixed(1)}km</span>
                {a.avgPacePerKm && <span className="text-moss">{"\u00b7"} {a.avgPacePerKm}</span>}
                {a.avgHeartRate && <span className="text-moss">{"\u00b7"} HR {a.avgHeartRate}</span>}
              </div>
            </Link>
          ))}
          {/* Missed indicator */}
          {!isRest && compatibleActivities.length === 0 && isPast && (
            <div className="bg-clay-soft border-2 border-clay rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-clay font-bold">
                <span>{"\u2717"}</span>
                <span>Missed</span>
                {workout.targetDistanceKm && <span className="text-moss font-semibold">{"\u00b7"} {workout.targetDistanceKm}km planned</span>}
              </div>
            </div>
          )}
          {/* Future workout targets */}
          {!isRest && compatibleActivities.length === 0 && !isPast && (
            <div className="text-xs text-moss">
              {workout.targetDistanceKm && <span>{workout.targetDistanceKm}km</span>}
              {workout.targetPace && <span> @ {workout.targetPace}</span>}
            </div>
          )}
          {/* Other activities — muted "also done" style (non-rest days only) */}
          {!isRest && otherActivities.length > 0 && (
            <div className="space-y-1">
              {otherActivities.map((a) => (
                <Link key={a.id} href={`/activity/${a.id}`} className="block bg-ghost border border-shade rounded-lg px-3 py-1.5 hover:bg-shade/50 transition-colors">
                  <div className="flex items-center gap-2 text-xs text-moss">
                    <span className="text-sage">Also:</span>
                    <span className="text-ink font-semibold">{a.name}</span>
                    {a.distanceKm && <span>{a.distanceKm.toFixed(1)}km</span>}
                    {a.source === "manual" && <span className="text-sage">(manual)</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
          {/* Rest day with activities */}
          {isRest && dayActivities.length > 0 && (
            <div className="space-y-1">
              {dayActivities.map((a) => (
                <Link key={a.id} href={`/activity/${a.id}`} className="block bg-ghost border border-shade rounded-lg px-3 py-1.5 hover:bg-shade/50 transition-colors">
                  <div className="flex items-center gap-2 text-xs text-moss">
                    <span className="text-sage">Also:</span>
                    <span className="text-ink font-semibold">{a.name}</span>
                    {a.distanceKm && <span>{a.distanceKm.toFixed(1)}km</span>}
                  </div>
                </Link>
              ))}
              <p className="text-[10px] text-sage font-semibold">Bonus work on a rest day.</p>
            </div>
          )}
        </div>
      )}

      <div className="border-b border-shade mx-4" />
    </div>
  );
}

function MobileWeekCard({
  weekData,
  workouts,
  tasks,
  onToggleTask,
  activitiesByDate,
}: {
  weekData: PlanWeekData;
  workouts: Workout[];
  tasks: WeeklyTask[];
  onToggleTask: (id: string, status: string) => void;
  activitiesByDate: Record<string, DayActivity[]>;
}) {
  const isOutline = weekData.detailLevel === "outline";
  const isTarget = weekData.detailLevel === "target";
  const isPast = new Date(weekData.startDate) < new Date(todayStr);
  // Compute actual running km from activities on this week's dates
  const weekDates = new Set(workouts.map((w) => w.date.split("T")[0]));
  const weekRunKm = weekData.actualKm ?? Array.from(weekDates).reduce((sum, d) => {
    const acts = activitiesByDate[d] || [];
    return sum + acts.filter((a) => isRunning(a.activityType)).reduce((s, a) => s + (a.distanceKm || 0), 0);
  }, 0);

  // Only one day expanded at a time; today auto-expanded
  const todayWorkoutIdx = workouts.findIndex((w) => isToday(w.date));
  const [expandedIdx, setExpandedIdx] = useState(todayWorkoutIdx >= 0 ? todayWorkoutIdx : -1);

  const sessionCodes = weekData.sessionTypes as string[] | null;

  return (
    <div className="flex flex-col h-full">
      {/* Week header */}
      <div className="px-4 pt-4 pb-3 border-b border-shade flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold text-ink">
              Week {weekData.weekNumber}
              {weekData.phaseName && <span className="text-moss font-semibold"> · {weekData.phaseName}</span>}
            </h2>
            <p className="text-xs text-moss mt-0.5">{formatWeekRange(weekData.startDate)}</p>
          </div>
          <div className="text-right">
            {isPast && weekRunKm > 0 ? (
              <p className="text-sm font-bold text-ink">{weekRunKm.toFixed(0)} km actual</p>
            ) : weekData.targetKm ? (
              <p className="text-sm font-bold text-moss">{weekData.targetKm.toFixed(0)}km target</p>
            ) : null}
            {weekData.targetSessions && (
              <p className="text-[10px] text-sage font-semibold">{weekData.targetSessions} sessions</p>
            )}
          </div>
        </div>
        {weekData.notes && (
          <p className="text-xs text-ink bg-[#faeed8] border-2 border-sun rounded-lg px-2.5 py-1.5 mt-2">{weekData.notes}</p>
        )}
      </div>

      {/* Day rows or summary */}
      <div className="flex-1 overflow-y-auto">
        {isTarget ? (
          <div className="flex items-center justify-center h-full text-center px-8">
            <div>
              <p className="text-moss text-sm font-bold">Not yet planned</p>
              <p className="text-sage text-xs mt-1 font-semibold">Details will be generated as this week approaches.</p>
              {sessionCodes && (
                <p className="text-xs text-sage mt-3 font-mono">{sessionCodes.join(" · ")}</p>
              )}
            </div>
          </div>
        ) : isOutline ? (
          <div className="px-4 py-4">
            <p className="text-sm text-moss font-semibold mb-3">Outline — details coming soon</p>
            {workouts.map((w) => (
              <div key={w.id} className="flex items-center gap-2 py-1.5">
                <div className="w-2 h-2 rounded-full border border-ink/60" style={{ backgroundColor: getWorkoutTypeColor(w.workoutType) }} />
                <span className="text-sm text-ink font-semibold">{w.title}</span>
                {w.targetDistanceKm && <span className="text-xs text-moss ml-auto">~{w.targetDistanceKm}km</span>}
              </div>
            ))}
            {sessionCodes && workouts.length === 0 && (
              <p className="text-xs text-sage font-mono mt-2">{sessionCodes.join(" · ")}</p>
            )}
          </div>
        ) : (
          <>
            {workouts.map((w, i) => (
              <MobileDayRow
                key={w.id}
                workout={w}
                isExpanded={expandedIdx === i}
                onTap={() => setExpandedIdx(expandedIdx === i ? -1 : i)}
                dayActivities={activitiesByDate[w.date.split("T")[0]] || []}
              />
            ))}
          </>
        )}

        {/* Weekly tasks */}
        {tasks.length > 0 && (
          <div className="px-4 pb-4">
            <TaskChecklist tasks={tasks} onToggle={onToggleTask} />
          </div>
        )}
      </div>
    </div>
  );
}

function MobilePlanView({
  weekList,
  workoutsByWeek,
  tasksByWeek,
  currentWeekIdx,
  onToggleTask,
  activitiesByDate,
}: {
  weekList: PlanWeekData[];
  workoutsByWeek: Map<number, Workout[]>;
  tasksByWeek: Map<number, WeeklyTask[]>;
  currentWeekIdx: number;
  onToggleTask: (id: string, status: string) => void;
  activitiesByDate: Record<string, DayActivity[]>;
}) {
  const [activeIdx, setActiveIdx] = useState(Math.max(0, currentWeekIdx));
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const [swiping, setSwiping] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const animatingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // "idle" | "exit" | "entering"
  const [phase, setPhase] = useState<"idle" | "exit" | "entering">("idle");

  const slideToWeek = useCallback((targetIdx: number, direction: number) => {
    if (animatingRef.current) return;
    const clamped = Math.max(0, Math.min(weekList.length - 1, targetIdx));
    if (clamped === activeIdx) {
      // Bounce back
      setSwipeOffset(0);
      setSwiping(false);
      return;
    }
    animatingRef.current = true;
    // Phase 1: slide current card off screen
    const width = containerRef.current?.offsetWidth || 400;
    setSwiping(false);
    setPhase("exit");
    setSwipeOffset(direction * width);

    // After exit animation completes, swap content and enter from opposite side
    setTimeout(() => {
      setActiveIdx(clamped);
      setPhase("entering");
      setSwipeOffset(-direction * width);
      // Force a layout read so the entering position is applied instantly
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setPhase("idle");
          setSwipeOffset(0);
          setTimeout(() => { animatingRef.current = false; }, 250);
        });
      });
    }, 220);
  }, [activeIdx, weekList.length]);

  function onTouchStart(e: React.TouchEvent) {
    if (animatingRef.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    setSwiping(true);
    setPhase("idle");
  }
  function onTouchMove(e: React.TouchEvent) {
    if (animatingRef.current) return;
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
    // Rubber band at edges
    if (activeIdx === 0 && touchDeltaX.current > 0) touchDeltaX.current = touchDeltaX.current * 0.3;
    if (activeIdx === weekList.length - 1 && touchDeltaX.current < 0) touchDeltaX.current = touchDeltaX.current * 0.3;
    setSwipeOffset(touchDeltaX.current);
  }
  function onTouchEnd() {
    if (animatingRef.current) return;
    const width = containerRef.current?.offsetWidth || 400;
    const threshold = width * 0.3;
    if (touchDeltaX.current < -threshold && activeIdx < weekList.length - 1) {
      slideToWeek(activeIdx + 1, -1);
    } else if (touchDeltaX.current > threshold && activeIdx > 0) {
      slideToWeek(activeIdx - 1, 1);
    } else {
      // Cancel — spring back
      setSwiping(false);
      setSwipeOffset(0);
    }
  }

  const week = weekList[activeIdx];
  if (!week) return null;

  // Transition style: no transition while dragging or when jumping to the entering position
  const useTransition = !swiping && phase !== "entering";

  return (
    <div className="flex flex-col h-[calc(100vh-52px-3.5rem)]">
      {/* Navigation arrows */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-shade flex-shrink-0">
        <button
          onClick={() => slideToWeek(activeIdx - 1, 1)}
          disabled={activeIdx === 0 || animatingRef.current}
          className="p-1.5 text-moss hover:text-ink disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <span className="text-xs text-moss font-semibold">Week {week.weekNumber} of {weekList.length}</span>
          {activeIdx === currentWeekIdx && <span className="text-[9px] text-leaf font-bold ml-2">Current</span>}
        </div>
        <button
          onClick={() => slideToWeek(activeIdx + 1, -1)}
          disabled={activeIdx === weekList.length - 1 || animatingRef.current}
          className="p-1.5 text-moss hover:text-ink disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>

      {/* Swipeable card area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="h-full will-change-transform"
          style={{
            transform: `translateX(${swipeOffset}px)`,
            transition: useTransition ? "transform 0.25s ease-out" : "none",
          }}
        >
          <MobileWeekCard
            weekData={week}
            workouts={workoutsByWeek.get(week.weekNumber) || []}
            tasks={tasksByWeek.get(week.weekNumber) || []}
            onToggleTask={onToggleTask}
            activitiesByDate={activitiesByDate}
          />
        </div>
      </div>
    </div>
  );
}

// ============================
// DESKTOP VIEW — Collapsible Weeks (existing)
// ============================

function DesktopWorkoutCard({ workout, dayActivities }: { workout: Workout; dayActivities: DayActivity[] }) {
  const isRest = workout.workoutType === "rest";
  const isPast = isPastDate(workout.date);
  const compatibleActivities = dayActivities.filter((a) => isCompatibleType(workout.activityType, a.activityType));
  const otherActivities = dayActivities.filter((a) => !isCompatibleType(workout.activityType, a.activityType));
  const isCompleted = !isRest && compatibleActivities.length > 0;
  const isMissed = isPast && !isCompleted && !isRest;

  return (
    <div className={`border-2 border-ink rounded-[14px] shadow-[2px_2px_0_var(--color-shade)] px-3 py-2 ${getWorkoutTypeBg(workout.workoutType)} ${isMissed && dayActivities.length === 0 ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          <span className={`text-sm font-bold ${isCompleted ? "text-leaf" : isMissed ? "text-moss" : "text-ink"}`}>{workout.title}</span>
          {isCompleted && <span className="text-xs">{"\u2705"}</span>}
          {isMissed && <span className="text-xs text-clay font-bold">missed</span>}
        </div>
        <span className="text-xs text-moss">{new Date(workout.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
      </div>
      {!isRest && (
        <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-moss">
          {workout.targetDistanceKm && <span>{workout.targetDistanceKm}km</span>}
          {workout.targetPace && <span>{workout.targetPace}</span>}
          {workout.targetDurationMin && <span>{workout.targetDurationMin}min</span>}
        </div>
      )}
      {workout.description && !isRest && (
        <p className="text-[11px] text-moss mt-1 ml-4 line-clamp-2">{workout.description}</p>
      )}
      {compatibleActivities.map((a) => (
        <div key={a.id} className="mt-1.5 ml-4 bg-sprout border-2 border-ink rounded-lg px-2 py-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-leaf">{"\u2705"}</span>
            <span className="text-ink font-bold">{a.distanceKm?.toFixed(1)}km</span>
            {a.avgPacePerKm && <span className="text-moss">{"\u00b7"} {a.avgPacePerKm}</span>}
            {a.avgHeartRate && <span className="text-moss">{"\u00b7"} HR {a.avgHeartRate}</span>}
          </div>
        </div>
      ))}
      {!isRest && otherActivities.map((a) => (
        <div key={a.id} className="mt-1 ml-4 text-[11px] text-moss">Also: {a.name}{a.distanceKm ? ` ${a.distanceKm.toFixed(1)}km` : ""}</div>
      ))}
      {isRest && dayActivities.map((a) => (
        <div key={a.id} className="mt-1 ml-4 text-[11px] text-moss">Also: {a.name}{a.distanceKm ? ` ${a.distanceKm.toFixed(1)}km` : ""}</div>
      ))}
    </div>
  );
}

function DesktopWeekRow({
  weekData, workouts, tasks, isCurrentWeek, isNextWeek, onToggleTask, activitiesByDate,
}: {
  weekData: PlanWeekData; workouts: Workout[]; tasks: WeeklyTask[];
  isCurrentWeek: boolean; isNextWeek: boolean;
  onToggleTask: (id: string, status: string) => void;
  activitiesByDate: Record<string, DayActivity[]>;
}) {
  const isOutline = weekData.detailLevel === "outline";
  const isTarget = weekData.detailLevel === "target";
  const isPast = new Date(weekData.startDate) < new Date(todayStr);
  const [expanded, setExpanded] = useState(isCurrentWeek || isNextWeek);
  const hasWorkouts = workouts.length > 0;
  const canExpand = hasWorkouts;
  const weekKm = workouts.reduce((s, w) => s + (w.targetDistanceKm || 0), 0);
  const dWeekDates = new Set(workouts.map((w) => w.date.split("T")[0]));
  const actualKm = weekData.actualKm ?? Array.from(dWeekDates).reduce((sum, d) => {
    const acts = activitiesByDate[d] || [];
    return sum + acts.filter((a) => isRunning(a.activityType)).reduce((s, a) => s + (a.distanceKm || 0), 0);
  }, 0);
  const completedCount = workouts.filter((w) => {
    if (w.workoutType === "rest") return false;
    const acts = activitiesByDate[w.date.split("T")[0]] || [];
    return acts.some((a) => isCompatibleType(w.activityType, a.activityType));
  }).length;
  const totalCount = workouts.filter((w) => w.workoutType !== "rest").length;
  const sessionCodes = weekData.sessionTypes as string[] | null;

  return (
    <div className={`mb-3 ${isCurrentWeek ? "ring-2 ring-brocco rounded-xl p-3 -mx-3" : ""}`}>
      {isCurrentWeek && <div className="text-xs text-leaf mb-2 font-bold">Current Week</div>}
      <button
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-ink shadow-[2px_2px_0_var(--color-shade)] text-left transition-colors ${canExpand ? "sticker-press cursor-pointer" : "cursor-default"} ${expanded ? "bg-ghost" : "bg-card"}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {canExpand && <span className="text-xs text-sage flex-shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>}
          <span className="text-sm font-bold text-ink">Week {weekData.weekNumber}</span>
          {weekData.phaseName && <span className="text-xs text-moss bg-ghost border border-shade px-2 py-0.5 rounded truncate">{weekData.phaseName}</span>}
          {isTarget && <span className="text-[10px] text-ghost-ink bg-ghost px-1.5 py-0.5 rounded">Not yet planned</span>}
          {isOutline && <span className="text-[10px] text-ink bg-[#e3eefa] border border-ink px-1.5 py-0.5 rounded">Outline</span>}
        </div>
        <div className="text-xs text-moss flex items-center gap-3 flex-shrink-0">
          {isPast && actualKm > 0 ? (
            <span><span className="text-ink font-bold">{actualKm.toFixed(0)}</span>{weekData.targetKm ? ` / ${weekData.targetKm.toFixed(0)} km` : " km"}{totalCount > 0 && ` · ${completedCount}/${totalCount}`}</span>
          ) : weekData.targetKm ? (
            <span>~{weekData.targetKm.toFixed(0)} km{weekData.targetSessions && ` · ${weekData.targetSessions} sessions`}</span>
          ) : null}
          {sessionCodes && !expanded && <span className="text-[10px] text-sage font-mono">{sessionCodes.join("")}</span>}
        </div>
      </button>
      {weekData.notes && <p className="text-xs text-ink bg-[#faeed8] border-2 border-sun rounded-lg px-2.5 py-1.5 mt-2">{weekData.notes}</p>}
      {expanded && hasWorkouts && (
        <div className="mt-2 space-y-1.5 px-1">
          {workouts.map((w) => <DesktopWorkoutCard key={w.id} workout={w} dayActivities={activitiesByDate[w.date.split("T")[0]] || []} />)}
          <TaskChecklist tasks={tasks} onToggle={onToggleTask} />
        </div>
      )}
    </div>
  );
}

// --- Nav ---

function Nav() {
  return (
    <nav className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-6 border-b-2 border-ink/10">
      <div className="hidden md:flex items-center justify-between pb-6">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-8 h-8 rounded-full border-2 border-ink" />
          <span className="font-extrabold text-lg text-ink">brocco.run</span>
        </div>
        <DesktopNavLinks />
      </div>
    </nav>
  );
}

function MobileNav({ planName, onNewPlan, starting }: { planName: string; onNewPlan: () => void; starting: boolean }) {
  return (
    <nav className="safe-top flex items-center justify-between px-4 pb-2 border-b-2 border-ink/10 bg-cream/95 backdrop-blur-sm flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
        <span className="font-bold text-sm text-ink truncate">{planName}</span>
      </div>
      <button onClick={onNewPlan} disabled={starting} className="text-xs text-leaf font-bold hover:opacity-70 transition-opacity flex-shrink-0">
        {starting ? "..." : "+ New plan"}
      </button>
    </nav>
  );
}

// ============================
// MAIN PAGE
// ============================

export default function PlanPage() {
  return (
    <Suspense fallback={<main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><Nav /><div className="text-moss text-center py-12 font-semibold">Loading...</div></main>}>
      <PlanPageContent />
    </Suspense>
  );
}

function PlanPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingPlan, setStartingPlan] = useState(false);

  useEffect(() => {
    fetch("/api/plan").then((r) => r.json()).then((d) => setPlan(d.plan)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (searchParams.get("new") === "1" && !loading) handleNewPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function handleNewPlan() {
    setStartingPlan(true);
    router.push(`/chat?msg=${encodeURIComponent("I'd like to build a new training plan")}`);
  }

  async function handleToggleTask(id: string, status: string) {
    if (!plan) return;
    setPlan({ ...plan, weeklyTasks: plan.weeklyTasks.map((t) => t.id === id ? { ...t, status } : t) });
    await fetch("/api/plan/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  }

  if (loading) {
    return <main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><Nav /><div className="text-moss text-center py-12 font-semibold">Loading...</div></main>;
  }

  if (!plan) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <Nav />
        <div className="text-center py-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt="" className="h-32 mx-auto mb-4" />
          <p className="text-ink text-lg font-extrabold">No training plan yet</p>
          <p className="text-moss text-sm mt-2 mb-4 font-semibold">Let Brocco build you a personalized plan.</p>
          <button onClick={handleNewPlan} disabled={startingPlan} className="btn-brocco px-6 py-2.5">
            {startingPlan ? "Starting..." : "Build a new plan"}
          </button>
        </div>
      </main>
    );
  }

  // Build week data
  const hasWeeks = plan.weeks && plan.weeks.length > 0;
  const workoutsByWeek = new Map<number, Workout[]>();
  for (const w of plan.workouts) {
    if (!workoutsByWeek.has(w.weekNumber)) workoutsByWeek.set(w.weekNumber, []);
    workoutsByWeek.get(w.weekNumber)!.push(w);
  }
  const tasksByWeek = new Map<number, WeeklyTask[]>();
  for (const t of plan.weeklyTasks || []) {
    if (!tasksByWeek.has(t.weekNumber)) tasksByWeek.set(t.weekNumber, []);
    tasksByWeek.get(t.weekNumber)!.push(t);
  }

  let weekList: PlanWeekData[];
  if (hasWeeks) {
    weekList = plan.weeks;
  } else {
    const weekNums = Array.from(workoutsByWeek.keys()).sort((a, b) => a - b);
    weekList = weekNums.map((wn) => {
      const wk = workoutsByWeek.get(wn) || [];
      const phase = plan.phases.find((p) => wn >= p.startWeek && wn <= p.endWeek);
      return {
        id: `legacy-${wn}`, weekNumber: wn, startDate: wk.length > 0 ? wk[0].date : plan.startDate,
        detailLevel: "detailed", targetKm: wk.reduce((s, w) => s + (w.targetDistanceKm || 0), 0) || null,
        targetSessions: wk.filter((w) => w.workoutType !== "rest").length, sessionTypes: null, notes: null, actualKm: null,
        phaseName: phase?.name || null,
      };
    });
  }

  const currentWeekIdx = weekList.findIndex((w) => {
    const end = new Date(w.startDate); end.setDate(end.getDate() + 6);
    return w.startDate.split("T")[0] <= todayStr && end.toISOString().split("T")[0] >= todayStr;
  });
  const currentWeekNum = currentWeekIdx >= 0 ? weekList[currentWeekIdx].weekNumber : undefined;
  const totalWeeks = weekList.length || 1;

  return (
    <>
      {/* MOBILE VIEW */}
      <div className="md:hidden h-[calc(100vh-3.5rem)] flex flex-col">
        <MobileNav planName={plan.name} onNewPlan={handleNewPlan} starting={startingPlan} />
        <MobilePlanView
          weekList={weekList}
          workoutsByWeek={workoutsByWeek}
          tasksByWeek={tasksByWeek}
          currentWeekIdx={currentWeekIdx >= 0 ? currentWeekIdx : 0}
          onToggleTask={handleToggleTask}
          activitiesByDate={plan.activitiesByDate || {}}
        />
      </div>

      {/* DESKTOP VIEW */}
      <main className="hidden md:block min-h-screen max-w-2xl mx-auto px-4 py-6 pb-20">
        <Nav />
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-extrabold text-ink">{plan.name}</h1>
            <button onClick={handleNewPlan} disabled={startingPlan} className="btn-quiet px-3 py-1.5 text-xs disabled:opacity-50">
              {startingPlan ? "Starting..." : "New Plan"}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-moss font-semibold">
            {plan.goal && <span>{plan.goal}</span>}
            {plan.raceDate && <span>Race: {new Date(plan.raceDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
            <span className="text-sage">{weekList.length} weeks</span>
          </div>
          {plan.phases.length > 0 && (
            <>
              <div className="flex gap-1 mt-3">
                {plan.phases.map((phase) => {
                  const pw = phase.endWeek - phase.startWeek + 1;
                  return (
                    <div key={phase.id} className="rounded-full h-2 bg-shade relative overflow-hidden" style={{ width: `${(pw / totalWeeks) * 100}%` }}>
                      {currentWeekNum !== undefined && currentWeekNum >= phase.startWeek && currentWeekNum <= phase.endWeek && (
                        <div className="absolute inset-y-0 left-0 bg-brocco rounded-full" style={{ width: `${((currentWeekNum - phase.startWeek + 1) / pw) * 100}%` }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1 mt-1">
                {plan.phases.map((phase) => (
                  <div key={phase.id} style={{ width: `${((phase.endWeek - phase.startWeek + 1) / totalWeeks) * 100}%` }}>
                    <span className="label-xs truncate block">{phase.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {weekList.map((wd) => (
          <DesktopWeekRow
            key={wd.id} weekData={wd}
            workouts={workoutsByWeek.get(wd.weekNumber) || []}
            tasks={tasksByWeek.get(wd.weekNumber) || []}
            isCurrentWeek={wd.weekNumber === currentWeekNum}
            isNextWeek={currentWeekNum !== undefined && wd.weekNumber === currentWeekNum + 1}
            onToggleTask={handleToggleTask}
            activitiesByDate={plan.activitiesByDate || {}}
          />
        ))}
      </main>
    </>
  );
}
