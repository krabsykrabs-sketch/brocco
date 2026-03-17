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

// Color map for activity types (from Strava sport_type values)
function getActivityColor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("trail")) return "#3b82f6";
  if (t === "run" || t === "virtualrun" || t === "treadmill") return "#4ade80";
  if (t === "ride" || t === "virtualride") return "#14b8a6";
  if (t === "swim") return "#06b6d4";
  if (t === "hike" || t === "walk") return "#a78bfa";
  if (t.includes("weight") || t.includes("strength")) return "#a855f7";
  if (t === "yoga") return "#c084fc";
  return "#6b7280";
}

interface PlannedWorkout {
  id: string;
  title: string;
  workoutType: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  status: string;
  matchedActivityId: string | null;
}

interface DayData {
  date: string;
  dayName: string;
  dayNum: string;
  isToday: boolean;
  activities: {
    id: string;
    name: string;
    activityType: string;
    distanceKm: number | null;
    avgPacePerKm: string | null;
    avgHeartRate: number | null;
  }[];
  planned?: PlannedWorkout[];
}

interface WeeklyBar {
  week: string;
  km: number;
  plannedKm: number;
}

interface ActivityItem {
  id: string;
  stravaId: string | null;
  name: string;
  activityType: string;
  distanceKm: number | null;
  durationMin: number | null;
  avgPacePerKm: string | null;
  avgHeartRate: number | null;
  startDateLocal: string;
  source: string;
}

interface HealthNote {
  id: string;
  entryType: string;
  description: string;
  bodyPart: string | null;
  severity: string | null;
  date: string;
}

interface PlanAdjustment {
  id: string;
  action: string;
  summary: string;
  reason: string;
  createdAt: string;
}

interface WeeklyTaskItem {
  id: string;
  description: string;
  category: string;
  status: string;
}

interface DashboardData {
  userName: string;
  goalRace: string | null;
  goalTime: string | null;
  daysUntilRace: number | null;
  currentWeekKm: number;
  currentWeekPlannedKm: number;
  avgEasyPace: string | null;
  weekDays: DayData[];
  weeklyData: WeeklyBar[];
  recentActivities: ActivityItem[];
  healthNotes: HealthNote[];
  weeklyTasks: WeeklyTaskItem[];
  hasActivePlan: boolean;
  planExpired: boolean;
  activePlanName: string | null;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function severityColor(s: string | null): string {
  if (s === "severe") return "text-red-400";
  if (s === "moderate") return "text-yellow-400";
  return "text-orange-300";
}

// Workout type colors per style guide
function getWorkoutTypeColor(type: string): string {
  switch (type) {
    case "easy":
    case "recovery": return "#4ade80";
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

// --- Sub-components ---

function WeekGrid({ days }: { days: DayData[] }) {
  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {days.map((day) => {
        const hasPlanned = day.planned && day.planned.length > 0;
        const hasActivities = day.activities.length > 0;
        const isPast = day.date < today;

        // Determine day status for border color
        const isRest = hasPlanned && day.planned!.every((w) => w.workoutType === "rest");
        const isCompleted = hasPlanned && day.planned!.some((w) => w.matchedActivityId);
        const isMissed = isPast && hasPlanned && !isRest && !isCompleted;

        let borderClass = "";
        if (isCompleted) borderClass = "border border-green-800/60";
        else if (isMissed) borderClass = "border border-red-900/50";
        else if (isRest) borderClass = "border border-gray-800/40";

        return (
          <div
            key={day.date}
            className={`rounded-lg p-2 min-h-[80px] ${
              day.isToday
                ? "bg-gray-800 ring-1 ring-green-500/50"
                : "bg-gray-900"
            } ${borderClass}`}
          >
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[11px] text-gray-500 uppercase">{day.dayName}</span>
              <span className={`text-xs font-medium ${day.isToday ? "text-green-400" : "text-gray-400"}`}>
                {day.dayNum}
              </span>
            </div>
            {/* Planned workouts */}
            {hasPlanned && day.planned!.map((w) => (
              <div key={w.id} className="mt-0.5">
                <div className="flex items-center gap-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getWorkoutTypeColor(w.workoutType) }}
                  />
                  <span className={`text-[10px] truncate ${w.matchedActivityId ? "text-green-400" : "text-gray-500"}`}>
                    {w.title}
                  </span>
                </div>
                {w.targetDistanceKm && (
                  <div className="text-[10px] text-gray-600 ml-2.5">
                    {w.targetDistanceKm.toFixed(0)}km {w.targetPace || ""}
                  </div>
                )}
              </div>
            ))}
            {/* Actual activities */}
            {hasActivities ? (
              day.activities.map((a) => (
                <Link key={a.id} href={`/activity/${a.id}`} className="block mt-1 hover:opacity-80">
                  {a.distanceKm && (
                    <div className="text-[11px] text-green-300 font-medium">
                      {a.distanceKm.toFixed(1)} km
                    </div>
                  )}
                  {a.avgPacePerKm && (
                    <div className="text-[10px] text-gray-400">{a.avgPacePerKm}</div>
                  )}
                  {a.avgHeartRate && (
                    <div className="text-[10px] text-gray-500">HR {a.avgHeartRate}</div>
                  )}
                </Link>
              ))
            ) : !hasPlanned ? (
              <div className="text-[10px] text-gray-700 mt-2">-</div>
            ) : null}
          </div>
        );
      })}
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
          <XAxis
            dataKey="week"
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            interval={1}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#6b7280" }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={[0, Math.ceil(maxKm / 10) * 10]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: "12px",
              color: "#e5e7eb",
            }}
          />
          {hasPlanned && (
            <Bar dataKey="plannedKm" name="Planned" radius={[3, 3, 0, 0]} maxBarSize={32} fill="#374151" opacity={0.5} />
          )}
          <Bar dataKey="km" name="Actual" radius={[3, 3, 0, 0]} maxBarSize={32}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={index === data.length - 1 ? "#4ade80" : "#6b7280"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricsPanel({
  currentWeekKm,
  currentWeekPlannedKm,
  daysUntilRace,
  avgEasyPace,
  goalRace,
}: {
  currentWeekKm: number;
  currentWeekPlannedKm: number;
  daysUntilRace: number | null;
  avgEasyPace: string | null;
  goalRace: string | null;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="bg-gray-900 rounded-lg p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">This week</p>
        <p className="text-xl font-semibold text-white mt-1">
          {currentWeekKm.toFixed(1)}
          <span className="text-xs text-gray-400 ml-1">km</span>
        </p>
        {currentWeekPlannedKm > 0 && (
          <p className="text-[10px] text-gray-500 mt-0.5">
            / {currentWeekPlannedKm.toFixed(0)} planned
          </p>
        )}
      </div>
      <div className="bg-gray-900 rounded-lg p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
          {daysUntilRace !== null && daysUntilRace > 0 ? "Race in" : "Easy pace"}
        </p>
        <p className="text-xl font-semibold text-white mt-1">
          {daysUntilRace !== null && daysUntilRace > 0 ? (
            <>
              {daysUntilRace}
              <span className="text-xs text-gray-400 ml-1">days</span>
            </>
          ) : avgEasyPace ? (
            <span className="text-lg">{avgEasyPace}</span>
          ) : (
            <span className="text-gray-600">-</span>
          )}
        </p>
        {daysUntilRace !== null && daysUntilRace > 0 && goalRace && (
          <p className="text-[10px] text-gray-500 mt-0.5 truncate">{goalRace}</p>
        )}
      </div>
      <div className="bg-gray-900 rounded-lg p-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Easy pace</p>
        <p className="text-xl font-semibold text-white mt-1">
          {avgEasyPace ? (
            <span className="text-lg">{avgEasyPace}</span>
          ) : (
            <span className="text-gray-600">-</span>
          )}
        </p>
      </div>
    </div>
  );
}

function ActivityFeed({ activities }: { activities: ActivityItem[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No activities yet.</p>
        <p className="text-gray-600 text-sm mt-1">
          Connect Strava in{" "}
          <Link href="/settings" className="text-green-400 underline">
            Settings
          </Link>{" "}
          to import your runs.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <Link key={a.id} href={`/activity/${a.id}`} className="block bg-gray-900 rounded-lg px-3 py-2.5 flex items-center gap-3 hover:bg-gray-800 transition-colors">
          <div
            className="w-1 h-10 rounded-full flex-shrink-0"
            style={{ backgroundColor: getActivityColor(a.activityType) }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{a.name}</p>
            <p className="text-xs text-gray-500">
              {formatDate(a.startDateLocal)}
              {a.source === "manual" && " (manual)"}
            </p>
          </div>
          <div className="text-right flex-shrink-0 space-y-0.5">
            {a.distanceKm && (
              <p className="text-sm text-gray-300">{a.distanceKm.toFixed(1)} km</p>
            )}
            <div className="flex items-center gap-2 justify-end">
              {a.avgPacePerKm && (
                <p className="text-xs text-gray-500">{a.avgPacePerKm}</p>
              )}
              {a.avgHeartRate && (
                <p className="text-xs text-gray-500">{a.avgHeartRate} bpm</p>
              )}
            </div>
            {a.stravaId && (
              <span className="text-[11px] text-[#FC4C02]">Strava</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

function HealthNotes({
  notes,
  onResolve,
  onAdd,
}: {
  notes: HealthNote[];
  onResolve: (id: string) => void;
  onAdd: (description: string, bodyPart: string, severity: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [desc, setDesc] = useState("");
  const [bodyPart, setBodyPart] = useState("");
  const [severity, setSeverity] = useState("minor");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!desc.trim()) return;
    onAdd(desc.trim(), bodyPart.trim(), severity);
    setDesc("");
    setBodyPart("");
    setSeverity("minor");
    setShowAdd(false);
  }

  return (
    <div className="space-y-2">
      {notes.map((n) => (
        <div key={n.id} className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {n.severity && (
                <span className={`text-xs font-medium ${severityColor(n.severity)}`}>
                  {n.severity}
                </span>
              )}
              {n.bodyPart && (
                <span className="text-xs text-gray-400">{n.bodyPart}</span>
              )}
              <span className="text-xs text-gray-600">
                {n.entryType}
              </span>
            </div>
            <button
              onClick={() => onResolve(n.id)}
              className="text-xs text-gray-500 hover:text-green-400 transition-colors"
              title="Mark resolved"
            >
              Resolve
            </button>
          </div>
          <p className="text-sm text-gray-300 mt-0.5">{n.description}</p>
        </div>
      ))}

      {showAdd ? (
        <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-2">
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What's going on? (e.g., left knee soreness)"
            className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              value={bodyPart}
              onChange={(e) => setBodyPart(e.target.value)}
              placeholder="Body part"
              className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          + Add health note
        </button>
      )}
    </div>
  );
}

function PlanAdjustments({
  adjustments,
  onUndo,
}: {
  adjustments: PlanAdjustment[];
  onUndo: (id: string) => void;
}) {
  if (adjustments.length === 0) return null;

  return (
    <div className="space-y-2">
      {adjustments.map((a) => (
        <div key={a.id} className="bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-blue-400">Plan adjusted</span>
            <button
              onClick={() => onUndo(a.id)}
              className="text-xs text-gray-500 hover:text-yellow-400 transition-colors"
            >
              Undo
            </button>
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
    <nav className="sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm flex items-center justify-between py-3 -mx-4 px-4 mb-6">
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
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/plan/adjustments")
      .then((r) => r.json())
      .then((d) => setAdjustments(d.adjustments || []))
      .catch(() => {});
  }, []);

  async function handleResolveHealth(id: string) {
    const res = await fetch("/api/health", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "resolved" }),
    });
    if (res.ok && data) {
      setData({ ...data, healthNotes: data.healthNotes.filter((n) => n.id !== id) });
    }
  }

  async function handleAddHealth(description: string, bodyPart: string, severity: string) {
    const res = await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryType: "note",
        description,
        bodyPart: bodyPart || null,
        severity: severity || null,
      }),
    });
    if (res.ok && data) {
      const { note } = await res.json();
      setData({ ...data, healthNotes: [note, ...data.healthNotes] });
    }
  }

  async function handleToggleTask(id: string, status: string) {
    if (!data) return;
    setData({
      ...data,
      weeklyTasks: data.weeklyTasks.map((t) =>
        t.id === id ? { ...t, status } : t
      ),
    });
    await fetch("/api/plan/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }

  async function handleUndoAdjustment(id: string) {
    const res = await fetch("/api/plan/adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setAdjustments((prev) => prev.filter((a) => a.id !== id));
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <NavBar />
        <div className="text-gray-500 text-center py-12">Loading...</div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <NavBar />
        <div className="text-red-400 text-center py-12">Failed to load dashboard.</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6 pb-20">
      <NavBar />

      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          Hey {data.userName} &#x1F966;
        </h1>
        {data.goalRace && data.goalTime && (
          <p className="text-sm text-gray-400 mt-0.5">
            {data.goalRace} &middot; {data.goalTime}
          </p>
        )}
      </div>

      {/* No plan prompt */}
      {(!data.hasActivePlan || data.planExpired) && (
        <div className="mb-6 bg-green-900/20 border border-green-800/40 rounded-lg p-4 flex items-center gap-3">
          <span className="text-2xl flex-shrink-0">🥦</span>
          <div className="flex-1">
            <p className="text-sm text-gray-200 font-medium">
              {data.planExpired
                ? `${data.activePlanName || "Your plan"} is done! Ready for what's next?`
                : "No active plan yet. Chat with Brocco to build one whenever you're ready."}
            </p>
          </div>
          <Link
            href="/chat?startPlan=1"
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0"
          >
            Build a plan
          </Link>
        </div>
      )}

      {/* Plan adjustments */}
      {adjustments.length > 0 && (
        <section className="mb-6">
          <PlanAdjustments adjustments={adjustments} onUndo={handleUndoAdjustment} />
        </section>
      )}

      {/* Health notes */}
      <section className="mb-6">
        <HealthNotes
          notes={data.healthNotes}
          onResolve={handleResolveHealth}
          onAdd={handleAddHealth}
        />
      </section>

      {/* Metrics */}
      <section className="mb-6">
        <MetricsPanel
          currentWeekKm={data.currentWeekKm}
          currentWeekPlannedKm={data.currentWeekPlannedKm}
          daysUntilRace={data.daysUntilRace}
          avgEasyPace={data.avgEasyPace}
          goalRace={data.goalRace}
        />
      </section>

      {/* Current week */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
          This Week
        </h2>
        <WeekGrid days={data.weekDays} />
        {data.currentWeekPlannedKm > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            This week: <span className="text-gray-300">{data.currentWeekKm.toFixed(1)} km</span> of {data.currentWeekPlannedKm.toFixed(0)} km planned
          </p>
        )}
        {data.weeklyTasks.length > 0 && (
          <div className="mt-3 space-y-1">
            {data.weeklyTasks.map((t) => (
              <button
                key={t.id}
                onClick={() => handleToggleTask(t.id, t.status === "done" ? "pending" : "done")}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <span className={`text-xs ${t.status === "done" ? "text-green-400" : "text-gray-600"}`}>
                  {t.status === "done" ? "\u2611" : "\u2610"}
                </span>
                <span className="text-xs">
                  {({ strength: "\ud83d\udcaa", mobility: "\ud83e\uddd8", nutrition: "\ud83e\udd66", recovery: "\ud83d\udca4" } as Record<string, string>)[t.category] || "\u2705"}
                </span>
                <span className={`text-xs flex-1 ${t.status === "done" ? "text-gray-500 line-through" : "text-gray-300"}`}>
                  {t.description}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Mileage chart */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-2">
          Weekly Mileage
        </h2>
        <div className="bg-gray-900 rounded-lg p-3">
          <MileageChart data={data.weeklyData} />
        </div>
      </section>

      {/* Recent activities */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Recent Activities
          </h2>
          <Link href="/history" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            View all
          </Link>
        </div>
        <ActivityFeed activities={data.recentActivities} />
      </section>
    </main>
  );
}
