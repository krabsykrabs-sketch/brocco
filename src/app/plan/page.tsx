"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// --- Types ---

interface Phase { id: string; name: string; orderIndex: number; description: string | null; startWeek: number; endWeek: number; }
interface MatchedActivity { id: string; name: string; distanceKm: number | null; durationMin: number; avgPacePerKm: string | null; avgHeartRate: number | null; }
interface Workout { id: string; phaseId: string | null; weekNumber: number; date: string; title: string; workoutType: string; activityType: string; targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null; description: string | null; status: string; matchedActivity: MatchedActivity | null; }
interface PlanWeekData { id: string; weekNumber: number; startDate: string; detailLevel: string; targetKm: number | null; targetSessions: number | null; sessionTypes: string[] | null; notes: string | null; actualKm: number | null; phaseName: string | null; }
interface WeeklyTask { id: string; weekNumber: number; description: string; category: string; status: string; }
interface Plan { id: string; name: string; goal: string | null; raceDate: string | null; startDate: string; endDate: string; status: string; phases: Phase[]; weeks: PlanWeekData[]; workouts: Workout[]; weeklyTasks: WeeklyTask[]; }

// --- Shared Utilities ---

function getWorkoutTypeColor(type: string): string {
  switch (type) {
    case "easy": case "recovery": return "#4ade80";
    case "tempo": return "#fb923c";
    case "interval": return "#ef4444";
    case "race_pace": return "#ea580c";
    case "long": return "#3b82f6";
    case "cross_training": return "#14b8a6";
    case "strength": return "#a855f7";
    case "rest": return "#6b7280";
    case "race": return "#eab308";
    default: return "#6b7280";
  }
}

function getWorkoutTypeBg(type: string): string {
  switch (type) {
    case "easy": case "recovery": return "bg-green-900/30 border-green-800/40";
    case "tempo": return "bg-orange-900/30 border-orange-800/40";
    case "interval": return "bg-red-900/30 border-red-800/40";
    case "race_pace": return "bg-orange-900/40 border-orange-700/40";
    case "long": return "bg-blue-900/30 border-blue-800/40";
    case "cross_training": return "bg-teal-900/30 border-teal-800/40";
    case "strength": return "bg-purple-900/30 border-purple-800/40";
    case "rest": return "bg-gray-900/50 border-gray-800/40";
    case "race": return "bg-yellow-900/30 border-yellow-800/40";
    default: return "bg-gray-900/50 border-gray-800/40";
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
        <button key={t.id} onClick={() => onToggle(t.id, t.status === "done" ? "pending" : "done")} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900/50 border border-gray-800/40 hover:bg-gray-800/50 transition-colors text-left">
          <span className={`text-xs ${t.status === "done" ? "text-green-400" : "text-gray-600"}`}>{t.status === "done" ? "\u2611" : "\u2610"}</span>
          <span className="text-xs">{icons[t.category] || "\u2705"}</span>
          <span className={`text-xs flex-1 ${t.status === "done" ? "text-gray-500 line-through" : "text-gray-300"}`}>{t.description}</span>
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
}: {
  workout: Workout;
  isExpanded: boolean;
  onTap: () => void;
}) {
  const day = getDayLabel(workout.date);
  const isTodayRow = isToday(workout.date);
  const isPast = isPastDate(workout.date);
  const isRest = workout.workoutType === "rest";
  const isCompleted = workout.status === "completed";
  const isMissed = isPast && !isCompleted && !isRest;

  const details = [
    workout.targetDistanceKm ? `${workout.targetDistanceKm}km` : null,
    workout.targetPace,
    workout.targetDurationMin ? `${workout.targetDurationMin}min` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      onClick={onTap}
      className={`transition-colors cursor-pointer ${
        isTodayRow
          ? "bg-gray-800/80 border-l-2 border-l-green-500"
          : isMissed
          ? "border-l-2 border-l-red-800/60"
          : "border-l-2 border-l-transparent"
      } ${isPast && !isCompleted && !isRest ? "opacity-60" : ""}`}
    >
      {/* Main row */}
      <div className="flex items-center px-4 py-3 gap-3">
        {/* Day label */}
        <div className="w-12 flex-shrink-0">
          <div className={`text-xs font-bold ${isTodayRow ? "text-green-400" : "text-gray-400"}`}>{day.abbr}</div>
          <div className={`text-lg font-bold leading-none ${isTodayRow ? "text-white" : "text-gray-300"}`}>{day.num}</div>
        </div>

        {/* Workout info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
            <span className={`text-sm font-medium ${isCompleted ? "text-green-400" : isRest ? "text-gray-500" : "text-gray-200"}`}>
              {workout.title}
            </span>
            {isCompleted && <span className="text-xs">{"\u2705"}</span>}
            {isTodayRow && <span className="text-[9px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-semibold">TODAY</span>}
          </div>
          {!isRest && details && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{details}</p>
          )}
        </div>

        {/* Expand indicator */}
        {!isRest && (
          <span className="text-xs text-gray-600 flex-shrink-0">{isExpanded ? "\u25B2" : "\u25BC"}</span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && !isRest && (
        <div className="px-4 pb-3 pl-16">
          {workout.description && (
            <p className="text-xs text-gray-400 leading-relaxed mb-2">{workout.description}</p>
          )}
          {workout.matchedActivity && (
            <div className="bg-gray-800/60 rounded-lg px-3 py-2 mb-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-green-400">{"\u2713"}</span>
                <span className="text-green-300 font-medium">{workout.matchedActivity.distanceKm?.toFixed(1)}km</span>
                {workout.matchedActivity.avgPacePerKm && <span className="text-gray-400">{workout.matchedActivity.avgPacePerKm}</span>}
                {workout.matchedActivity.avgHeartRate && <span className="text-gray-400">HR {workout.matchedActivity.avgHeartRate}</span>}
              </div>
              <Link href={`/activity/${workout.matchedActivity.id}`} className="text-[11px] text-[#FC4C02] hover:underline mt-1 inline-block">
                View on Strava
              </Link>
            </div>
          )}
          {!workout.matchedActivity && !isPast && (
            <div className="text-xs text-gray-500">
              {workout.targetDistanceKm && <span>{workout.targetDistanceKm}km</span>}
              {workout.targetPace && <span> @ {workout.targetPace}</span>}
            </div>
          )}
        </div>
      )}

      <div className="border-b border-gray-800/50 mx-4" />
    </div>
  );
}

function MobileWeekCard({
  weekData,
  workouts,
  tasks,
  onToggleTask,
}: {
  weekData: PlanWeekData;
  workouts: Workout[];
  tasks: WeeklyTask[];
  onToggleTask: (id: string, status: string) => void;
}) {
  const isOutline = weekData.detailLevel === "outline";
  const isTarget = weekData.detailLevel === "target";
  const isPast = new Date(weekData.startDate) < new Date(todayStr);
  const actualKm = weekData.actualKm ?? workouts.reduce((s, w) => s + (w.matchedActivity?.distanceKm || 0), 0);

  // Only one day expanded at a time; today auto-expanded
  const todayWorkoutIdx = workouts.findIndex((w) => isToday(w.date));
  const [expandedIdx, setExpandedIdx] = useState(todayWorkoutIdx >= 0 ? todayWorkoutIdx : -1);

  const sessionCodes = weekData.sessionTypes as string[] | null;

  return (
    <div className="flex flex-col h-full">
      {/* Week header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">
              Week {weekData.weekNumber}
              {weekData.phaseName && <span className="text-gray-500 font-normal"> · {weekData.phaseName}</span>}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{formatWeekRange(weekData.startDate)}</p>
          </div>
          <div className="text-right">
            {isPast && actualKm > 0 ? (
              <p className="text-sm font-medium text-gray-300">{actualKm.toFixed(0)} km actual</p>
            ) : weekData.targetKm ? (
              <p className="text-sm font-medium text-gray-400">{weekData.targetKm.toFixed(0)}km target</p>
            ) : null}
            {weekData.targetSessions && (
              <p className="text-[10px] text-gray-600">{weekData.targetSessions} sessions</p>
            )}
          </div>
        </div>
        {weekData.notes && (
          <p className="text-xs text-yellow-400/70 mt-1">{weekData.notes}</p>
        )}
      </div>

      {/* Day rows or summary */}
      <div className="flex-1 overflow-y-auto">
        {isTarget ? (
          <div className="flex items-center justify-center h-full text-center px-8">
            <div>
              <p className="text-gray-500 text-sm">Not yet planned</p>
              <p className="text-gray-600 text-xs mt-1">Details will be generated as this week approaches.</p>
              {sessionCodes && (
                <p className="text-xs text-gray-600 mt-3 font-mono">{sessionCodes.join(" · ")}</p>
              )}
            </div>
          </div>
        ) : isOutline ? (
          <div className="px-4 py-4">
            <p className="text-sm text-gray-400 mb-3">Outline — details coming soon</p>
            {workouts.map((w) => (
              <div key={w.id} className="flex items-center gap-2 py-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getWorkoutTypeColor(w.workoutType) }} />
                <span className="text-sm text-gray-300">{w.title}</span>
                {w.targetDistanceKm && <span className="text-xs text-gray-500 ml-auto">~{w.targetDistanceKm}km</span>}
              </div>
            ))}
            {sessionCodes && workouts.length === 0 && (
              <p className="text-xs text-gray-600 font-mono mt-2">{sessionCodes.join(" · ")}</p>
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
}: {
  weekList: PlanWeekData[];
  workoutsByWeek: Map<number, Workout[]>;
  tasksByWeek: Map<number, WeeklyTask[]>;
  currentWeekIdx: number;
  onToggleTask: (id: string, status: string) => void;
}) {
  const [activeIdx, setActiveIdx] = useState(Math.max(0, currentWeekIdx));
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const [swiping, setSwiping] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((idx: number) => {
    setActiveIdx(Math.max(0, Math.min(weekList.length - 1, idx)));
  }, [weekList.length]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    setSwiping(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
    // Clamp at edges
    if (activeIdx === 0 && touchDeltaX.current > 0) touchDeltaX.current = touchDeltaX.current * 0.3;
    if (activeIdx === weekList.length - 1 && touchDeltaX.current < 0) touchDeltaX.current = touchDeltaX.current * 0.3;
    setSwipeOffset(touchDeltaX.current);
  }
  function onTouchEnd() {
    setSwiping(false);
    const threshold = 60;
    if (touchDeltaX.current < -threshold) goTo(activeIdx + 1);
    else if (touchDeltaX.current > threshold) goTo(activeIdx - 1);
    setSwipeOffset(0);
  }

  const week = weekList[activeIdx];
  if (!week) return null;

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Navigation arrows */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800/50 flex-shrink-0">
        <button
          onClick={() => goTo(activeIdx - 1)}
          disabled={activeIdx === 0}
          className="p-1.5 text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <span className="text-xs text-gray-500">Week {week.weekNumber} of {weekList.length}</span>
          {activeIdx === currentWeekIdx && <span className="text-[9px] text-green-400 ml-2">Current</span>}
        </div>
        <button
          onClick={() => goTo(activeIdx + 1)}
          disabled={activeIdx === weekList.length - 1}
          className="p-1.5 text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-default transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
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
          className="h-full"
          style={{
            transform: `translateX(${swipeOffset}px)`,
            transition: swiping ? "none" : "transform 0.25s ease-out",
          }}
        >
          <MobileWeekCard
            weekData={week}
            workouts={workoutsByWeek.get(week.weekNumber) || []}
            tasks={tasksByWeek.get(week.weekNumber) || []}
            onToggleTask={onToggleTask}
          />
        </div>
      </div>
    </div>
  );
}

// ============================
// DESKTOP VIEW — Collapsible Weeks (existing)
// ============================

function DesktopWorkoutCard({ workout }: { workout: Workout }) {
  const isRest = workout.workoutType === "rest";
  const isPast = isPastDate(workout.date);

  return (
    <div className={`border rounded-lg px-3 py-2 ${getWorkoutTypeBg(workout.workoutType)} ${isPast && workout.status === "planned" ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          <span className="text-sm font-medium text-gray-200">{workout.title}</span>
          {workout.status === "completed" && <span className="text-xs">{"\u2705"}</span>}
        </div>
        <span className="text-xs text-gray-500">{new Date(workout.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</span>
      </div>
      {!isRest && (
        <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-gray-400">
          {workout.targetDistanceKm && <span>{workout.targetDistanceKm}km</span>}
          {workout.targetPace && <span>{workout.targetPace}</span>}
          {workout.targetDurationMin && <span>{workout.targetDurationMin}min</span>}
        </div>
      )}
      {workout.description && !isRest && (
        <p className="text-[11px] text-gray-500 mt-1 ml-4 line-clamp-2">{workout.description}</p>
      )}
      {workout.matchedActivity && (
        <div className="mt-1.5 ml-4 bg-gray-800/60 rounded px-2 py-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-green-400 font-medium truncate">{workout.matchedActivity.name}</span>
            <div className="flex items-center gap-2 text-gray-400 flex-shrink-0">
              {workout.matchedActivity.distanceKm && <span>{workout.matchedActivity.distanceKm.toFixed(1)}km</span>}
              {workout.matchedActivity.avgPacePerKm && <span>{workout.matchedActivity.avgPacePerKm}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopWeekRow({
  weekData, workouts, tasks, isCurrentWeek, isNextWeek, onToggleTask,
}: {
  weekData: PlanWeekData; workouts: Workout[]; tasks: WeeklyTask[];
  isCurrentWeek: boolean; isNextWeek: boolean;
  onToggleTask: (id: string, status: string) => void;
}) {
  const isOutline = weekData.detailLevel === "outline";
  const isTarget = weekData.detailLevel === "target";
  const isPast = new Date(weekData.startDate) < new Date(todayStr);
  const [expanded, setExpanded] = useState(isCurrentWeek || isNextWeek);
  const hasWorkouts = workouts.length > 0;
  const canExpand = hasWorkouts;
  const weekKm = workouts.reduce((s, w) => s + (w.targetDistanceKm || 0), 0);
  const actualKm = weekData.actualKm ?? workouts.reduce((s, w) => s + (w.matchedActivity?.distanceKm || 0), 0);
  const completedCount = workouts.filter((w) => w.status === "completed").length;
  const totalCount = workouts.filter((w) => w.workoutType !== "rest").length;
  const sessionCodes = weekData.sessionTypes as string[] | null;

  return (
    <div className={`mb-3 ${isCurrentWeek ? "ring-1 ring-green-500/30 rounded-xl p-3 -mx-3" : ""}`}>
      {isCurrentWeek && <div className="text-xs text-green-400 mb-2 font-medium">Current Week</div>}
      <button
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${canExpand ? "hover:bg-gray-800/50 cursor-pointer" : "cursor-default"} ${expanded ? "bg-gray-900/50" : "bg-gray-900/30"}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {canExpand && <span className="text-xs text-gray-600 flex-shrink-0">{expanded ? "\u25BC" : "\u25B6"}</span>}
          <span className="text-sm font-semibold text-gray-300">Week {weekData.weekNumber}</span>
          {weekData.phaseName && <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded truncate">{weekData.phaseName}</span>}
          {isTarget && <span className="text-[10px] text-gray-600 bg-gray-800/50 px-1.5 py-0.5 rounded">Not yet planned</span>}
          {isOutline && <span className="text-[10px] text-blue-400/60 bg-blue-900/20 px-1.5 py-0.5 rounded">Outline</span>}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-3 flex-shrink-0">
          {isPast && actualKm > 0 ? (
            <span><span className="text-gray-300">{actualKm.toFixed(0)}</span>{weekData.targetKm ? ` / ${weekData.targetKm.toFixed(0)} km` : " km"}{totalCount > 0 && ` · ${completedCount}/${totalCount}`}</span>
          ) : weekData.targetKm ? (
            <span>~{weekData.targetKm.toFixed(0)} km{weekData.targetSessions && ` · ${weekData.targetSessions} sessions`}</span>
          ) : null}
          {sessionCodes && !expanded && <span className="text-[10px] text-gray-600 font-mono">{sessionCodes.join("")}</span>}
        </div>
      </button>
      {weekData.notes && <p className="text-xs text-yellow-400/70 mt-1 px-3">{weekData.notes}</p>}
      {expanded && hasWorkouts && (
        <div className="mt-2 space-y-1.5 px-1">
          {workouts.map((w) => <DesktopWorkoutCard key={w.id} workout={w} />)}
          <TaskChecklist tasks={tasks} onToggle={onToggleTask} />
        </div>
      )}
    </div>
  );
}

// --- Nav ---

function Nav() {
  return (
    <nav className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm flex items-center justify-between py-3 -mx-4 px-4 mb-6">
      <div className="flex items-center gap-2">
        <span className="text-2xl">&#x1F966;</span>
        <span className="font-bold text-lg">brocco.run</span>
      </div>
      <div className="flex items-center gap-4 text-sm text-gray-400">
        <Link href="/" className="hover:text-white transition-colors">Dashboard</Link>
        <Link href="/chat" className="hover:text-white transition-colors">Chat</Link>
        <Link href="/history" className="hover:text-white transition-colors">History</Link>
        <Link href="/settings" className="hover:text-white transition-colors">Settings</Link>
      </div>
    </nav>
  );
}

// Mobile-only minimal nav
function MobileNav({ planName, onNewPlan, starting }: { planName: string; onNewPlan: () => void; starting: boolean }) {
  return (
    <nav className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-950/95 backdrop-blur-sm flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xl">&#x1F966;</span>
        <span className="font-semibold text-sm truncate">{planName}</span>
      </div>
      <div className="flex items-center gap-3 text-sm text-gray-400 flex-shrink-0">
        <Link href="/" className="hover:text-white transition-colors">Dashboard</Link>
        <Link href="/chat" className="hover:text-white transition-colors">Chat</Link>
        <button onClick={onNewPlan} disabled={starting} className="text-xs text-gray-500 hover:text-white transition-colors">
          {starting ? "..." : "New"}
        </button>
      </div>
    </nav>
  );
}

// ============================
// MAIN PAGE
// ============================

export default function PlanPage() {
  return (
    <Suspense fallback={<main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><Nav /><div className="text-gray-500 text-center py-12">Loading...</div></main>}>
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

  async function handleNewPlan() {
    setStartingPlan(true);
    try {
      const res = await fetch("/api/plan/new-plan-session", { method: "POST" });
      const data = await res.json();
      router.push(`/chat/${data.id}`);
    } catch { setStartingPlan(false); }
  }

  async function handleToggleTask(id: string, status: string) {
    if (!plan) return;
    setPlan({ ...plan, weeklyTasks: plan.weeklyTasks.map((t) => t.id === id ? { ...t, status } : t) });
    await fetch("/api/plan/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  }

  if (loading) {
    return <main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><Nav /><div className="text-gray-500 text-center py-12">Loading...</div></main>;
  }

  if (!plan) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <Nav />
        <div className="text-center py-16">
          <p className="text-5xl mb-4">&#x1F966;</p>
          <p className="text-gray-400 text-lg font-medium">No training plan yet</p>
          <p className="text-gray-500 text-sm mt-2 mb-4">Let Brocco build you a personalized plan.</p>
          <button onClick={handleNewPlan} disabled={startingPlan} className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors">
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
      <div className="md:hidden h-screen flex flex-col">
        <MobileNav planName={plan.name} onNewPlan={handleNewPlan} starting={startingPlan} />
        <MobilePlanView
          weekList={weekList}
          workoutsByWeek={workoutsByWeek}
          tasksByWeek={tasksByWeek}
          currentWeekIdx={currentWeekIdx >= 0 ? currentWeekIdx : 0}
          onToggleTask={handleToggleTask}
        />
      </div>

      {/* DESKTOP VIEW */}
      <main className="hidden md:block min-h-screen max-w-2xl mx-auto px-4 py-6 pb-20">
        <Nav />
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-white">{plan.name}</h1>
            <button onClick={handleNewPlan} disabled={startingPlan} className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50">
              {startingPlan ? "Starting..." : "New Plan"}
            </button>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            {plan.goal && <span>{plan.goal}</span>}
            {plan.raceDate && <span>Race: {new Date(plan.raceDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
            <span className="text-gray-600">{weekList.length} weeks</span>
          </div>
          {plan.phases.length > 0 && (
            <>
              <div className="flex gap-1 mt-3">
                {plan.phases.map((phase) => {
                  const pw = phase.endWeek - phase.startWeek + 1;
                  return (
                    <div key={phase.id} className="rounded-full h-2 bg-gray-700 relative overflow-hidden" style={{ width: `${(pw / totalWeeks) * 100}%` }}>
                      {currentWeekNum !== undefined && currentWeekNum >= phase.startWeek && currentWeekNum <= phase.endWeek && (
                        <div className="absolute inset-y-0 left-0 bg-green-500 rounded-full" style={{ width: `${((currentWeekNum - phase.startWeek + 1) / pw) * 100}%` }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1 mt-1">
                {plan.phases.map((phase) => (
                  <div key={phase.id} style={{ width: `${((phase.endWeek - phase.startWeek + 1) / totalWeeks) * 100}%` }}>
                    <span className="text-[10px] text-gray-500 truncate block">{phase.name}</span>
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
          />
        ))}
      </main>
    </>
  );
}
