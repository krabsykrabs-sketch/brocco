"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// --- Types ---

interface PlannedWorkout {
  id: string;
  title: string;
  workoutType: string;
  activityType: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  status: string;
}

interface DayActivity {
  id: string;
  name: string;
  activityType: string;
  distanceKm: number | null;
  avgPacePerKm: string | null;
  avgHeartRate: number | null;
}

interface DayData {
  date: string;
  dayName: string;
  dayNum: string;
  isToday: boolean;
  activities: DayActivity[];
  planned?: PlannedWorkout[];
}

interface WeeklyBar { week: string; km: number; plannedKm: number; }
interface ActivityItem { id: string; stravaId: string | null; name: string; activityType: string; distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null; avgHeartRate: number | null; startDateLocal: string; source: string; }
interface HealthNote { id: string; entryType: string; description: string; bodyPart: string | null; severity: string | null; date: string; }
interface PlanAdjustment { id: string; action: string; summary: string; reason: string; createdAt: string; }
interface WeeklyTaskItem { id: string; description: string; category: string; status: string; }
interface CrossTrainingSummary { activityType: string; count: number; totalKm: number; }

interface DashboardData {
  userName: string;
  goalRace: string | null;
  goalTime: string | null;
  currentWeekKm: number;
  currentWeekAllKm: number;
  currentWeekPlannedKm: number;
  crossTrainingSummary: CrossTrainingSummary[];
  weekDays: DayData[];
  weeklyData: WeeklyBar[];
  recentActivities: ActivityItem[];
  healthNotes: HealthNote[];
  weeklyTasks: WeeklyTaskItem[];
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

function getActivityColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("trail")) return "#3b82f6";
  if (t === "run" || t === "virtualrun" || t === "treadmill") return "#4ade80";
  if (t === "ride" || t === "virtualride") return "#14b8a6";
  if (t === "swim") return "#06b6d4";
  if (t === "hike" || t === "walk") return "#a78bfa";
  if (t.includes("weight") || t.includes("strength")) return "#a855f7";
  return "#6b7280";
}

function formatDayHeader(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function severityColor(s: string | null): string {
  if (s === "severe") return "text-red-400";
  if (s === "moderate") return "text-yellow-400";
  return "text-orange-300";
}

function formatActivityType(type: string): string {
  const map: Record<string, string> = {
    Ride: "cycling", VirtualRide: "cycling", EBikeRide: "e-bike",
    MountainBikeRide: "MTB", Swim: "swimming", Hike: "hiking",
    Walk: "walking", WeightTraining: "weights", Workout: "workout",
    Yoga: "yoga", Padel: "padel", Tennis: "tennis",
  };
  return map[type] || type.toLowerCase();
}

// --- Components ---

function TodayCard({ day }: { day: DayData }) {
  const hasPlanned = day.planned && day.planned.length > 0;
  const hasActivities = day.activities.length > 0;
  const planned = hasPlanned ? day.planned![0] : null;
  const isRest = planned?.workoutType === "rest";

  return (
    <div className="rounded-xl bg-slate-800 border border-slate-600 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest">Today</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">{"\u00b7"} {formatDayHeader(day.date)}</span>
      </div>

      {/* Planned workout */}
      {planned && !isRest && (
        <div className="mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(planned.workoutType) }} />
            <span className="text-lg font-bold text-white">{planned.title}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 ml-5 text-sm text-slate-300">
            {planned.targetDistanceKm && <span className="font-medium">{planned.targetDistanceKm}km</span>}
            {planned.targetPace && <span className="text-slate-400">{planned.targetPace}</span>}
          </div>
        </div>
      )}

      {planned && isRest && !hasActivities && (
        <div className="mb-1">
          <p className="text-lg font-bold text-slate-400">Rest Day</p>
          <p className="text-sm text-slate-500 mt-0.5">Recover well — tomorrow counts.</p>
        </div>
      )}

      {!planned && !hasActivities && (
        <p className="text-sm text-slate-400">Nothing planned. Enjoy the day or go for a spontaneous run.</p>
      )}

      {/* Activities */}
      {hasActivities && (
        <div className="space-y-2">
          {day.activities.map((a) => (
            <Link key={a.id} href={`/activity/${a.id}`} className="block bg-black/25 rounded-lg px-3 py-2.5 hover:bg-black/35 transition-colors">
              <div className="flex items-center gap-2">
                <span className="text-green-400">{"\u2713"}</span>
                <span className="text-sm font-semibold text-green-300">{a.name}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 ml-5 text-sm text-slate-400">
                {a.distanceKm && <span className="text-white font-medium">{a.distanceKm.toFixed(1)}km</span>}
                {a.avgPacePerKm && <span>{a.avgPacePerKm}</span>}
                {a.avgHeartRate && <span>HR {a.avgHeartRate}</span>}
              </div>
            </Link>
          ))}
          {isRest && <p className="text-xs text-slate-500">Bonus work on a rest day — nice.</p>}
        </div>
      )}

      {planned && !isRest && !hasActivities && (
        <p className="text-xs text-slate-500 mt-2">Get after it today.</p>
      )}
    </div>
  );
}

function TomorrowCard({ day }: { day: DayData }) {
  const planned = day.planned && day.planned.length > 0 ? day.planned[0] : null;
  const isRest = planned?.workoutType === "rest";

  return (
    <div className="rounded-xl bg-gray-800/70 border border-gray-700 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tomorrow</span>
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{"\u00b7"} {formatDayHeader(day.date)}</span>
      </div>
      {planned && !isRest && (
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(planned.workoutType) }} />
          <span className="text-sm font-medium text-gray-200">{planned.title}</span>
          <span className="text-sm text-gray-500">
            {[planned.targetDistanceKm ? `${planned.targetDistanceKm}km` : null, planned.targetPace].filter(Boolean).join(" \u00b7 ")}
          </span>
        </div>
      )}
      {planned && isRest && <p className="text-sm text-gray-500">Rest day</p>}
      {!planned && <p className="text-sm text-gray-600">Nothing planned</p>}
    </div>
  );
}

function WeekProgressBar({ runKm, plannedKm, crossSummary }: { runKm: number; plannedKm: number; crossSummary: CrossTrainingSummary[] }) {
  const runPct = plannedKm > 0 ? Math.min((runKm / plannedKm) * 100, 150) : 0;

  return (
    <div className="rounded-xl bg-gray-800/70 border border-gray-700 px-4 py-3">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm text-gray-300">
          Running: <span className="font-semibold text-white">{runKm.toFixed(1)}km</span>
          {plannedKm > 0 && <span className="text-gray-500"> of {plannedKm.toFixed(0)}km planned</span>}
        </p>
        {plannedKm > 0 && (
          <span className={`text-xs font-medium ${runPct >= 100 ? "text-green-400" : "text-gray-500"}`}>{Math.round(runPct)}%</span>
        )}
      </div>
      {plannedKm > 0 && (
        <div className="h-2 bg-gray-900 rounded-full overflow-hidden relative">
          <div className="absolute top-0 left-0 h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(runPct, 100)}%` }} />
          <div className="absolute top-0 h-full w-px bg-gray-600" style={{ left: `${Math.min(100, (100 / Math.max(runPct, 100)) * 100)}%` }} />
        </div>
      )}
      {crossSummary.length > 0 && (
        <p className="text-[11px] text-gray-500 mt-2">
          Cross-training:{" "}
          {crossSummary.map((c, i) => {
            const label = formatActivityType(c.activityType);
            const detail = c.totalKm > 0 ? `${c.totalKm.toFixed(1)}km ${label}` : `${c.count} ${label} ${c.count === 1 ? "session" : "sessions"}`;
            return <span key={c.activityType}>{i > 0 && " \u00b7 "}{detail}</span>;
          })}
        </p>
      )}
    </div>
  );
}

function MileageChart({ data }: { data: WeeklyBar[] }) {
  const maxKm = Math.max(...data.map((d) => Math.max(d.km, d.plannedKm)), 1);
  const hasPlanned = data.some((d) => d.plannedKm > 0);

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} interval={1} />
          <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} width={40} domain={[0, Math.ceil(maxKm / 10) * 10]} />
          <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", fontSize: "12px", color: "#e5e7eb" }} />
          {hasPlanned && <Bar dataKey="plannedKm" name="Planned" radius={[3, 3, 0, 0]} maxBarSize={32} fill="#374151" opacity={0.5} />}
          <Bar dataKey="km" name="Actual" radius={[3, 3, 0, 0]} maxBarSize={32}>
            {data.map((_, index) => <Cell key={index} fill={index === data.length - 1 ? "#4ade80" : "#6b7280"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActivityFeed({ activities }: { activities: ActivityItem[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No activities yet.</p>
        <p className="text-gray-600 text-sm mt-1">Connect Strava in <Link href="/settings" className="text-green-400 underline">Settings</Link> to import your runs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <Link key={a.id} href={`/activity/${a.id}`} className="block bg-gray-900 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:bg-gray-800 transition-colors">
          <div className="w-1 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: getActivityColor(a.activityType) }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{a.name}</p>
            <p className="text-xs text-gray-500">{formatDate(a.startDateLocal)}{a.source === "manual" && " (manual)"}</p>
          </div>
          <div className="text-right flex-shrink-0 space-y-0.5">
            {a.distanceKm && <p className="text-sm text-gray-300">{a.distanceKm.toFixed(1)} km</p>}
            <div className="flex items-center gap-2 justify-end">
              {a.avgPacePerKm && <p className="text-xs text-gray-500">{a.avgPacePerKm}</p>}
              {a.avgHeartRate && <p className="text-xs text-gray-500">{a.avgHeartRate} bpm</p>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function HealthNotes({ notes, onResolve, onAdd }: { notes: HealthNote[]; onResolve: (id: string) => void; onAdd: (description: string, bodyPart: string, severity: string) => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [severity, setSeverity] = useState("minor");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim()) return;
    onAdd(desc.trim(), bodyPart.trim(), severity);
    setDesc(""); setBodyPart(""); setSeverity("minor"); setShowAdd(false);
  }

  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n.id} className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {n.severity && <span className={`text-xs font-medium ${severityColor(n.severity)}`}>{n.severity}</span>}
              {n.bodyPart && <span className="text-xs text-gray-400">{n.bodyPart}</span>}
            </div>
            <button onClick={() => onResolve(n.id)} className="text-xs text-gray-500 hover:text-green-400 transition-colors">Resolve</button>
          </div>
          <p className="text-sm text-gray-300 mt-0.5">{n.description}</p>
        </div>
      ))}
      {showAdd ? (
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2">
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What's going on? (e.g., left knee soreness)" className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500" autoFocus />
          <div className="flex gap-2">
            <input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="Body part" className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500" />
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors">Add</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">+ Add health note</button>
      )}
    </div>
  );
}

function PlanAdjustments({ adjustments, onUndo }: { adjustments: PlanAdjustment[]; onUndo: (id: string) => void }) {
  if (adjustments.length === 0) return null;
  return (
    <div className="space-y-2">
      {adjustments.map((a) => (
        <div key={a.id} className="bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-400">Plan adjusted</span>
            <button onClick={() => onUndo(a.id)} className="text-xs text-gray-500 hover:text-yellow-400 transition-colors">Undo</button>
          </div>
          <p className="text-sm text-gray-300 mt-0.5">{a.summary}</p>
        </div>
      ))}
    </div>
  );
}

// --- Nav ---

function NavBar() {
  return (
    <nav className="safe-top sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm flex items-center justify-between pb-6 -mx-4 px-4 mb-6">
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

  async function handleResolveHealth(id: string) {
    const res = await fetch("/api/health", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "resolved" }) });
    if (res.ok && data) setData({ ...data, healthNotes: data.healthNotes.filter((n) => n.id !== id) });
  }

  async function handleAddHealth(description: string, bodyPart: string, severity: string) {
    const res = await fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryType: "note", description, bodyPart: bodyPart || null, severity: severity || null }) });
    if (res.ok && data) { const { note } = await res.json(); setData({ ...data, healthNotes: [note, ...data.healthNotes] }); }
  }

  async function handleToggleTask(id: string, status: string) {
    if (!data) return;
    setData({ ...data, weeklyTasks: data.weeklyTasks.map((t) => t.id === id ? { ...t, status } : t) });
    await fetch("/api/plan/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  }

  async function handleUndoAdjustment(id: string) {
    const res = await fetch("/api/plan/adjustments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) setAdjustments((prev) => prev.filter((a) => a.id !== id));
  }

  if (loading) return <main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><NavBar /><div className="text-gray-500 text-center py-12">Loading...</div></main>;
  if (!data) return <main className="min-h-screen max-w-2xl mx-auto px-4 py-6"><NavBar /><div className="text-red-400 text-center py-12">Failed to load dashboard.</div></main>;

  const todayIdx = data.weekDays.findIndex((d) => d.isToday);
  const todayDay = todayIdx >= 0 ? data.weekDays[todayIdx] : null;
  const tomorrowDay = todayIdx >= 0 && todayIdx < 6 ? data.weekDays[todayIdx + 1] : null;

  const taskIcons: Record<string, string> = { strength: "\ud83d\udcaa", mobility: "\ud83e\uddd8", nutrition: "\ud83e\udd66", recovery: "\ud83d\udca4" };

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6 pb-20">
      <NavBar />

      {/* Greeting */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white">Hey {data.userName} &#x1F966;</h1>
        {data.activePlanName && (
          <p className="text-sm text-gray-400 mt-0.5">{data.activePlanName}</p>
        )}
      </div>

      {/* No plan prompt */}
      {(!data.hasActivePlan || data.planExpired) && (
        <div className="mb-5 bg-green-900/20 border border-green-800/40 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">&#x1F966;</span>
          <div className="flex-1">
            <p className="text-sm text-gray-200 font-medium">
              {data.planExpired
                ? `${data.activePlanName || "Your plan"} is done! Ready for what\u2019s next?`
                : "No active plan yet. Chat with Brocco to build one whenever you\u2019re ready."}
            </p>
          </div>
          <Link href="/chat?startPlan=1" className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0">
            Build a plan
          </Link>
        </div>
      )}

      {/* Plan adjustments */}
      {adjustments.length > 0 && (
        <section className="mb-5">
          <PlanAdjustments adjustments={adjustments} onUndo={handleUndoAdjustment} />
        </section>
      )}

      {/* === ABOVE THE FOLD === */}

      {/* Today card — hero */}
      {todayDay && (
        <section className="mb-3">
          <TodayCard day={todayDay} />
        </section>
      )}

      {/* Tomorrow */}
      {tomorrowDay && (
        <section className="mb-3">
          <TomorrowCard day={tomorrowDay} />
        </section>
      )}

      {/* Week progress */}
      <section className="mb-4">
        <WeekProgressBar runKm={data.currentWeekKm} plannedKm={data.currentWeekPlannedKm} crossSummary={data.crossTrainingSummary} />
      </section>

      {/* Weekly tasks */}
      {data.weeklyTasks.length > 0 && (
        <section className="mb-4 space-y-1">
          {data.weeklyTasks.map((t) => (
            <button key={t.id} onClick={() => handleToggleTask(t.id, t.status === "done" ? "pending" : "done")} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 transition-colors text-left">
              <span className={`text-xs ${t.status === "done" ? "text-green-400" : "text-gray-600"}`}>{t.status === "done" ? "\u2611" : "\u2610"}</span>
              <span className="text-xs">{taskIcons[t.category] || "\u2705"}</span>
              <span className={`text-xs flex-1 ${t.status === "done" ? "text-gray-500 line-through" : "text-gray-300"}`}>{t.description}</span>
            </button>
          ))}
        </section>
      )}

      {/* Ask Brocco button */}
      <section className="mb-6">
        <Link href="/chat" className="flex items-center justify-center gap-2 w-full py-3 bg-green-700 hover:bg-green-600 text-white font-medium rounded-xl transition-colors">
          <span>&#x1F4AC;</span>
          <span>Ask Brocco</span>
        </Link>
      </section>

      {/* === BELOW THE FOLD === */}

      {/* Mileage chart */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">Weekly Mileage</h2>
        <div className="bg-gray-900 rounded-lg p-3">
          <MileageChart data={data.weeklyData} />
        </div>
      </section>

      {/* Recent activities */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recent Activities</h2>
          <Link href="/history" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">View all</Link>
        </div>
        <ActivityFeed activities={data.recentActivities} />
      </section>

      {/* Health notes (below the fold) */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">Health Notes</h2>
        <HealthNotes notes={data.healthNotes} onResolve={handleResolveHealth} onAdd={handleAddHealth} />
      </section>
    </main>
  );
}
