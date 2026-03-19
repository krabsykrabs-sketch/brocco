"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { isCompatibleType } from "@/lib/activity-types";

// --- Types ---

interface PlannedWorkout { id: string; title: string; workoutType: string; activityType: string; targetDistanceKm: number | null; targetPace: string | null; status: string; }
interface DayActivity { id: string; name: string; activityType: string; distanceKm: number | null; avgPacePerKm: string | null; avgHeartRate: number | null; }
interface DayData { date: string; dayName: string; dayNum: string; isToday: boolean; activities: DayActivity[]; planned?: PlannedWorkout[]; }
interface CrossTrainingSummary { activityType: string; count: number; totalKm: number; }
interface PlanAdjustment { id: string; action: string; summary: string; reason: string; createdAt: string; }

interface DashboardData {
  userName: string;
  goalRace: string | null;
  goalTime: string | null;
  currentWeekKm: number;
  currentWeekPlannedKm: number;
  crossTrainingSummary: CrossTrainingSummary[];
  currentWeekSessions: number;
  completedSessions: number;
  currentWeekNumber: number | null;
  totalWeeks: number;
  currentPhaseName: string | null;
  weekStartDate: string;
  weekEndDate: string;
  raceDate: string | null;
  goalRaceDisplay: string | null;
  carouselDays: DayData[];
  hasActivePlan: boolean;
  planExpired: boolean;
  activePlanName: string | null;
}

// --- Utilities ---

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

function formatActivityType(type: string): string {
  const map: Record<string, string> = { Ride: "cycling", VirtualRide: "cycling", EBikeRide: "e-bike", MountainBikeRide: "MTB", Swim: "swimming", Hike: "hiking", Walk: "walking", WeightTraining: "weights", Workout: "workout", Yoga: "yoga", Padel: "padel", Tennis: "tennis" };
  return map[type] || type.toLowerCase();
}

// --- Contextual comment engine ---

function getContextualComment(day: DayData, prevDay: DayData | null, nextDay: DayData | null): string | null {
  const planned = day.planned?.[0] || null;
  const isRest = planned?.workoutType === "rest";
  const hasActivities = day.activities.length > 0;
  const today = new Date().toISOString().split("T")[0];
  const isPast = day.date < today;
  const isFuture = day.date > today;

  if (!planned && !hasActivities) return null;

  const hasCompatible = planned && !isRest && day.activities.some((a) => isCompatibleType(planned.activityType, a.activityType));

  if (day.activities.length >= 2) return "Two sessions today \u2014 solid commitment.";

  if (isRest && hasActivities && prevDay) {
    const prevPlanned = prevDay.planned?.[0];
    if (prevPlanned && prevPlanned.workoutType !== "rest") {
      const prevHadCompatible = prevDay.activities.some((a) => isCompatibleType(prevPlanned.activityType, a.activityType));
      if (!prevHadCompatible && prevDay.date < today) {
        return `Looks like you made up for yesterday\u2019s missed ${prevPlanned.title.toLowerCase()} \u2014 good instinct.`;
      }
    }
  }

  if (isRest && hasActivities && nextDay) {
    const nextPlanned = nextDay.planned?.[0];
    if (nextPlanned && ["tempo", "interval", "race_pace", "long"].includes(nextPlanned.workoutType)) {
      return `Big effort on a rest day. Tomorrow\u2019s ${nextPlanned.title.toLowerCase()} might feel heavy.`;
    }
  }

  if (hasCompatible && planned) {
    const matchedActivity = day.activities.find((a) => isCompatibleType(planned.activityType, a.activityType));
    if (matchedActivity?.avgPacePerKm && planned.targetPace) {
      const parsePace = (p: string) => { const m = p.match(/(\d+):(\d+)/); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0; };
      const actualSecs = parsePace(matchedActivity.avgPacePerKm);
      const targetSecs = parsePace(planned.targetPace);
      if (actualSecs > 0 && targetSecs > 0) {
        if (actualSecs < targetSecs - 15) return "Faster than planned \u2014 careful not to turn easy days into tempo efforts.";
        if (actualSecs > targetSecs + 20) return "A bit slower than planned. No stress \u2014 listen to your body.";
      }
    }
    return "Right on target. \u2713";
  }

  if (isPast && planned && !isRest && !hasCompatible) return "Missed one. Consistency over perfection.";
  if (isFuture) return null;
  return null;
}

// --- Day Card ---

function DayCard({ day, prevDay, nextDay }: { day: DayData; prevDay: DayData | null; nextDay: DayData | null }) {
  const d = new Date(day.date);
  const dayName = d.toLocaleDateString("en-GB", { weekday: "long" }).toUpperCase();
  const monthName = d.toLocaleDateString("en-GB", { month: "long" });
  const planned = day.planned?.[0] || null;
  const isRest = planned?.workoutType === "rest";
  const hasActivities = day.activities.length > 0;
  const comment = getContextualComment(day, prevDay, nextDay);

  return (
    <div className={`rounded-2xl p-4 h-full flex flex-col ${day.isToday ? "bg-slate-800 border-l-4 border-l-green-500 border border-slate-600" : "bg-gray-800/60 border border-gray-700/60"}`}>
      <div className="mb-3">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${day.isToday ? "text-green-400" : "text-gray-500"}`}>{dayName}</p>
        <p className="text-4xl font-black text-white leading-none mt-0.5">{day.dayNum}</p>
        <p className="text-xs text-gray-400 mt-0.5">{monthName}</p>
      </div>

      {planned && !isRest && (
        <div className="mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(planned.workoutType) }} />
            <span className="text-sm font-bold text-white">{planned.title}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 ml-4 text-xs text-gray-300">
            {planned.targetDistanceKm && <span className="font-medium">{planned.targetDistanceKm}km</span>}
            {planned.targetPace && <span className="text-gray-400">{planned.targetPace}</span>}
          </div>
        </div>
      )}
      {planned && isRest && !hasActivities && <p className="text-sm font-bold text-gray-500 mb-2">Rest Day</p>}
      {!planned && !hasActivities && <p className="text-xs text-gray-500 mb-2">Nothing planned</p>}

      {hasActivities && (
        <div className="space-y-1.5 flex-1">
          {day.activities.map((a) => (
            <Link key={a.id} href={`/activity/${a.id}`} className="block bg-black/20 rounded-lg px-3 py-1.5 hover:bg-black/30 transition-colors">
              <div className="flex items-center gap-1.5">
                <span className="text-green-400 text-xs">{"\u2713"}</span>
                <span className="text-xs font-semibold text-green-300 truncate">{a.name}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 ml-4 text-xs text-gray-400">
                {a.distanceKm && <span className="text-white font-medium">{a.distanceKm.toFixed(1)}km</span>}
                {a.avgPacePerKm && <span>{a.avgPacePerKm}</span>}
                {a.avgHeartRate && <span>HR {a.avgHeartRate}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}

      {comment && <p className="text-[10px] text-gray-500 mt-auto pt-2 italic">{comment}</p>}
    </div>
  );
}

// --- Horizontal Day Carousel ---

function DayCarousel({ days }: { days: DayData[] }) {
  const todayIdx = days.findIndex((d) => d.isToday);
  const [activeIdx, setActiveIdx] = useState(Math.max(0, todayIdx));
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const animatingRef = useRef(false);
  const [phase, setPhase] = useState<"idle" | "exit" | "entering">("idle");

  const getCardWidth = () => containerRef.current?.offsetWidth ?? 360;
  const PEEK_RATIO = 0.08;

  const slideToDay = useCallback((targetIdx: number, direction: number) => {
    if (animatingRef.current) return;
    const clamped = Math.max(0, Math.min(days.length - 1, targetIdx));
    if (clamped === activeIdx) { setSwipeOffset(0); setSwiping(false); directionLocked.current = null; return; }
    const w = getCardWidth();
    animatingRef.current = true;
    setSwiping(false);
    directionLocked.current = null;
    setPhase("exit");
    setSwipeOffset(direction * w);
    setTimeout(() => {
      setActiveIdx(clamped);
      setPhase("entering");
      setSwipeOffset(-direction * w);
      requestAnimationFrame(() => { requestAnimationFrame(() => { setPhase("idle"); setSwipeOffset(0); setTimeout(() => { animatingRef.current = false; }, 220); }); });
    }, 200);
  }, [activeIdx, days.length]);

  function onTouchStart(e: React.TouchEvent) {
    if (animatingRef.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchDeltaX.current = 0;
    directionLocked.current = null;
    setSwiping(true);
    setPhase("idle");
  }
  function onTouchMove(e: React.TouchEvent) {
    if (animatingRef.current) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!directionLocked.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      directionLocked.current = Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
    }
    if (directionLocked.current === "vertical") { setSwiping(false); return; }
    e.preventDefault();
    touchDeltaX.current = dx;
    if (activeIdx === 0 && dx > 0) touchDeltaX.current = dx * 0.3;
    if (activeIdx === days.length - 1 && dx < 0) touchDeltaX.current = dx * 0.3;
    setSwipeOffset(touchDeltaX.current);
  }
  function onTouchEnd() {
    if (animatingRef.current || directionLocked.current === "vertical") { setSwiping(false); directionLocked.current = null; return; }
    const w = getCardWidth();
    const threshold = w * 0.25;
    if (touchDeltaX.current < -threshold && activeIdx < days.length - 1) slideToDay(activeIdx + 1, -1);
    else if (touchDeltaX.current > threshold && activeIdx > 0) slideToDay(activeIdx - 1, 1);
    else { setSwiping(false); setSwipeOffset(0); }
    directionLocked.current = null;
  }

  const useTransition = !swiping && phase !== "entering";
  const day = days[activeIdx];
  const prevDay = activeIdx > 0 ? days[activeIdx - 1] : null;
  const nextDay = activeIdx < days.length - 1 ? days[activeIdx + 1] : null;

  return (
    <div className="relative -mx-4">
      <div ref={containerRef} className="overflow-hidden relative" style={{ touchAction: "pan-y" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div className="flex items-stretch" style={{ minHeight: 240 }}>
          <div className="flex-shrink-0 pointer-events-none overflow-hidden" style={{ width: `${PEEK_RATIO * 100}%` }}>
            {prevDay && swipeOffset === 0 && phase === "idle" && (
              <div className="h-full rounded-l-2xl bg-gray-800/30 border border-gray-700/20 p-2 opacity-40">
                <p className="text-[9px] text-gray-500 uppercase font-bold">{new Date(prevDay.date).toLocaleDateString("en-GB", { weekday: "short" })}</p>
                <p className="text-xl font-black text-gray-500 mt-0.5">{prevDay.dayNum}</p>
              </div>
            )}
          </div>
          <div className="flex-shrink-0 will-change-transform px-1" style={{
            width: `${(1 - PEEK_RATIO * 2) * 100}%`,
            transform: `translateX(${swipeOffset}px)`,
            transition: useTransition ? "transform 0.22s ease-out" : "none",
          }}>
            <DayCard day={day} prevDay={prevDay} nextDay={nextDay} />
          </div>
          <div className="flex-shrink-0 pointer-events-none overflow-hidden" style={{ width: `${PEEK_RATIO * 100}%` }}>
            {nextDay && swipeOffset === 0 && phase === "idle" && (
              <div className="h-full rounded-r-2xl bg-gray-800/30 border border-gray-700/20 p-2 opacity-40">
                <p className="text-[9px] text-gray-500 uppercase font-bold">{new Date(nextDay.date).toLocaleDateString("en-GB", { weekday: "short" })}</p>
                <p className="text-xl font-black text-gray-500 mt-0.5">{nextDay.dayNum}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 mt-2 px-4">
        {days.map((d, i) => (
          <button key={d.date} onClick={() => !animatingRef.current && slideToDay(i, i > activeIdx ? -1 : 1)}
            className={`rounded-full transition-all ${i === activeIdx ? (d.isToday ? "w-2.5 h-2.5 bg-green-400" : "w-2.5 h-2.5 bg-white") : (d.isToday ? "w-1.5 h-1.5 bg-green-400/50" : "w-1.5 h-1.5 bg-gray-600")}`} />
        ))}
      </div>
    </div>
  );
}

// --- This Week Summary Card ---

function ThisWeekCard({ data }: { data: DashboardData }) {
  const runPct = data.currentWeekPlannedKm > 0 ? Math.min((data.currentWeekKm / data.currentWeekPlannedKm) * 100, 150) : 0;
  const todayStr = new Date().toISOString().split("T")[0];

  // Get current week days from carousel (Mon-Sun of current week)
  const weekStart = data.weekStartDate;
  const weekEnd = data.weekEndDate;

  // Build 7-day dot strip from carousel days that fall in this week
  // We need Mon-Sun, carousel has 15 days centered on today
  const weekDays = data.carouselDays.filter((d) => {
    const dd = new Date(d.date);
    const dow = dd.getDay();
    // Check if in current week by matching the week start/end from API
    // Simple: the API gives us weekStartDate and weekEndDate as formatted strings
    // Use the carousel's isToday anchor + day of week to find the Mon-Sun range
    return true; // we'll use all 7 days logic below
  });

  // Find Monday of current week from carousel
  const todayData = data.carouselDays.find((d) => d.isToday);
  const todayDate = todayData ? new Date(todayData.date) : new Date();
  const todayDow = todayDate.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
  const mondayDate = new Date(todayDate);
  mondayDate.setDate(mondayDate.getDate() + mondayOffset);

  const dotDays: DayData[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const carouselDay = data.carouselDays.find((cd) => cd.date === dateStr);
    if (carouselDay) dotDays.push(carouselDay);
    else dotDays.push({ date: dateStr, dayName: "", dayNum: "", isToday: false, activities: [], planned: [] });
  }

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-600 px-4 py-4">
      {/* Header */}
      <div className="mb-3">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          This Week {"\u00b7"} {weekStart}\u2013{weekEnd}
        </p>
        {data.currentWeekNumber && (
          <p className="text-[10px] text-slate-500 mt-0.5">
            Week {data.currentWeekNumber}{data.totalWeeks > 0 && ` of ${data.totalWeeks}`}
            {data.currentPhaseName && ` \u00b7 ${data.currentPhaseName}`}
          </p>
        )}
      </div>

      {/* Running progress */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-sm text-slate-300">
            Running: <span className="font-semibold text-white">{data.currentWeekKm.toFixed(1)}</span>
            {data.currentWeekPlannedKm > 0 && <span className="text-slate-500"> / {data.currentWeekPlannedKm.toFixed(0)}km</span>}
          </p>
          {data.currentWeekPlannedKm > 0 && (
            <span className={`text-xs font-medium ${runPct >= 100 ? "text-green-400" : "text-slate-500"}`}>{Math.round(runPct)}%</span>
          )}
        </div>
        {data.currentWeekPlannedKm > 0 && (
          <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(runPct, 100)}%` }} />
          </div>
        )}
      </div>

      {/* Sessions progress */}
      {data.currentWeekSessions > 0 && (
        <p className="text-sm text-slate-300 mb-3">
          Sessions: <span className="font-semibold text-white">{data.completedSessions}</span>
          <span className="text-slate-500"> / {data.currentWeekSessions}</span>
        </p>
      )}

      {/* Cross-training */}
      {data.crossTrainingSummary.length > 0 && (
        <p className="text-[11px] text-slate-500 mb-3">
          Cross: {data.crossTrainingSummary.map((c, i) => {
            const label = formatActivityType(c.activityType);
            const detail = c.totalKm > 0 ? `${c.totalKm.toFixed(1)}km ${label}` : `${c.count} ${label} ${c.count === 1 ? "session" : "sessions"}`;
            return <span key={c.activityType}>{i > 0 && " \u00b7 "}{detail}</span>;
          })}
        </p>
      )}

      {/* Mini week dot strip */}
      <div className="flex items-center justify-center gap-3 mb-1.5">
        {dotDays.map((dd, i) => {
          const planned = dd.planned?.[0];
          const isRest = planned?.workoutType === "rest";
          const isPast = dd.date < todayStr;
          const isToday = dd.date === todayStr;
          const hasCompatible = planned && !isRest && dd.activities.some((a) => isCompatibleType(planned.activityType, a.activityType));
          const isMissed = isPast && planned && !isRest && !hasCompatible;

          let dotClass = "w-4 h-4 flex items-center justify-center text-[9px] font-bold";
          let content: string;

          if (isToday) {
            dotClass += " text-green-400";
            content = "\u25CF"; // filled circle
          } else if (hasCompatible) {
            dotClass += " text-green-400";
            content = "\u2713"; // check
          } else if (isMissed) {
            dotClass += " text-red-400";
            content = "\u2717"; // x
          } else if (isRest || !planned) {
            dotClass += " text-gray-600";
            content = "\u2591"; // light shade block
          } else {
            dotClass += " text-slate-500";
            content = "\u25CB"; // empty circle
          }

          return (
            <div key={dd.date} className="flex flex-col items-center gap-0.5">
              <span className="text-[8px] text-slate-600">{dayLabels[i]}</span>
              <span className={dotClass}>{content}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[8px] text-slate-600 text-center">
        {"\u2591"} rest {"\u00b7"} {"\u25CF"} today {"\u00b7"} {"\u25CB"} upcoming {"\u00b7"} {"\u2713"} done {"\u00b7"} {"\u2717"} missed
      </p>
    </div>
  );
}

// --- Race Countdown Card ---

function RaceCountdownCard({ data }: { data: DashboardData }) {
  if (!data.hasActivePlan || data.planExpired) return null;

  const daysUntil = data.raceDate
    ? Math.max(0, Math.ceil((new Date(data.raceDate).getTime() - Date.now()) / 86400000))
    : null;

  const raceLabel = data.goalRace || data.goalRaceDisplay || data.activePlanName;
  const raceDateStr = data.raceDate
    ? new Date(data.raceDate).toLocaleDateString("en-GB", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="rounded-xl bg-gray-800/50 border border-gray-700/50 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="text-lg">{"\uD83C\uDFAF"}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200 truncate">
            {data.goalTime && `${data.goalTime} `}{raceLabel}
          </p>
          <p className="text-xs text-gray-500">
            {raceDateStr && <>{raceDateStr}</>}
            {daysUntil !== null && daysUntil > 0 && <> {"\u00b7"} {daysUntil} days</>}
          </p>
        </div>
        {data.currentWeekNumber && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-gray-400">
              Week {data.currentWeekNumber}{data.totalWeeks > 0 && `/${data.totalWeeks}`}
            </p>
            {data.currentPhaseName && (
              <p className="text-[10px] text-gray-500">{data.currentPhaseName}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Nav ---

function NavBar() {
  return (
    <nav className="safe-top sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm -mx-4 px-4 mb-2">
      {/* Mobile: minimal branding only */}
      <div className="md:hidden flex items-center gap-2 pb-2">
        <span className="text-lg">&#x1F966;</span>
        <span className="font-semibold text-sm text-gray-300">brocco.run</span>
      </div>
      {/* Desktop: full nav */}
      <div className="hidden md:flex items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">&#x1F966;</span>
          <span className="font-bold text-lg">brocco.run</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <Link href="/chat" className="hover:text-white transition-colors">Chat</Link>
          <Link href="/plan" className="hover:text-white transition-colors">Plan</Link>
          <Link href="/history" className="hover:text-white transition-colors">History</Link>
          <Link href="/settings" className="hover:text-white transition-colors">Settings</Link>
        </div>
      </div>
    </nav>
  );
}

// --- Main ---

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [adjustments, setAdjustments] = useState<PlanAdjustment[]>([]);

  useEffect(() => {
    fetch("/api/dashboard").then((r) => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
    const lastPromo = localStorage.getItem("brocco_last_promo");
    const thisWeek = new Date().toISOString().slice(0, 10);
    if (!lastPromo || lastPromo < thisWeek) {
      fetch("/api/plan/promote", { method: "POST" }).then(() => localStorage.setItem("brocco_last_promo", thisWeek)).catch(() => {});
    }
    fetch("/api/plan/adjustments").then((r) => r.json()).then((d) => setAdjustments(d.adjustments || [])).catch(() => {});
  }, []);

  async function handleUndoAdjustment(id: string) {
    const res = await fetch("/api/plan/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) setAdjustments((prev) => prev.filter((a) => a.id !== id));
  }

  if (loading) return <main className="h-screen max-w-2xl mx-auto px-4 py-4"><NavBar /><div className="text-gray-500 text-center py-12">Loading...</div></main>;
  if (!data) return <main className="h-screen max-w-2xl mx-auto px-4 py-4"><NavBar /><div className="text-red-400 text-center py-12">Failed to load dashboard.</div></main>;

  return (
    <main className="h-screen max-w-2xl mx-auto px-4 py-4 flex flex-col">
      <NavBar />

      {/* 1. Greeting */}
      <div className="mb-2 flex-shrink-0">
        <h1 className="text-xl font-bold text-white">Hey {data.userName} &#x1F966;</h1>
        {data.activePlanName && <p className="text-xs text-gray-400 mt-0.5">{data.activePlanName}</p>}
      </div>

      {/* No plan prompt (replaces everything below if no plan) */}
      {(!data.hasActivePlan || data.planExpired) && (
        <div className="mb-3 bg-green-900/20 border border-green-800/40 rounded-xl p-4 flex items-center gap-3 flex-shrink-0">
          <span className="text-2xl flex-shrink-0">&#x1F966;</span>
          <div className="flex-1">
            <p className="text-sm text-gray-200 font-medium">
              {data.planExpired ? `${data.activePlanName || "Your plan"} is done!` : "No active plan yet."}
            </p>
          </div>
          <Link href="/chat?startPlan=1" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0">Build a plan</Link>
        </div>
      )}

      {/* Plan adjustments */}
      {adjustments.length > 0 && (
        <div className="mb-2 space-y-1 flex-shrink-0">
          {adjustments.map((a) => (
            <div key={a.id} className="bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-1.5 flex items-center justify-between">
              <p className="text-xs text-gray-300 truncate flex-1">{a.summary}</p>
              <button onClick={() => handleUndoAdjustment(a.id)} className="text-xs text-gray-500 hover:text-yellow-400 ml-2 flex-shrink-0">Undo</button>
            </div>
          ))}
        </div>
      )}

      {/* 2. Day Carousel */}
      <section className="mb-3 flex-shrink-0">
        <DayCarousel days={data.carouselDays} />
      </section>

      {/* 3. This Week Summary */}
      <section className="mb-3 flex-shrink-0">
        <ThisWeekCard data={data} />
      </section>

      {/* 4. Ask Brocco */}
      <section className="mb-3 flex-shrink-0">
        <Link href="/chat" className="flex items-center justify-center gap-2 w-full py-2.5 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-xl transition-colors">
          <span>&#x1F4AC;</span><span>Ask Brocco</span>
        </Link>
      </section>

      {/* 5. Race Countdown */}
      <section className="flex-shrink-0">
        <RaceCountdownCard data={data} />
      </section>
    </main>
  );
}
