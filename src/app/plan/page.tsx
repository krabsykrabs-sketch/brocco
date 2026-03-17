"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface Phase {
  id: string;
  name: string;
  orderIndex: number;
  description: string | null;
  startWeek: number;
  endWeek: number;
}

interface MatchedActivity {
  id: string;
  name: string;
  distanceKm: number | null;
  durationMin: number;
  avgPacePerKm: string | null;
  avgHeartRate: number | null;
}

interface Workout {
  id: string;
  phaseId: string | null;
  weekNumber: number;
  date: string;
  title: string;
  workoutType: string;
  activityType: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  targetDurationMin: number | null;
  description: string | null;
  status: string;
  matchedActivity: MatchedActivity | null;
}

interface WeeklyTask {
  id: string;
  weekNumber: number;
  description: string;
  category: string;
  status: string;
}

interface Plan {
  id: string;
  name: string;
  goal: string | null;
  raceDate: string | null;
  startDate: string;
  endDate: string;
  status: string;
  phases: Phase[];
  workouts: Workout[];
  weeklyTasks: WeeklyTask[];
}

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

function getWorkoutTypeBg(type: string): string {
  switch (type) {
    case "easy":
    case "recovery": return "bg-green-900/30 border-green-800/40";
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

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return "\u2705";
    case "skipped": return "\u23ed\ufe0f";
    case "modified": return "\u270f\ufe0f";
    default: return "";
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function WorkoutCard({ workout }: { workout: Workout }) {
  const isRest = workout.workoutType === "rest";
  const isPast = new Date(workout.date) < new Date(new Date().toDateString());

  return (
    <div
      className={`border rounded-lg px-3 py-2 ${getWorkoutTypeBg(workout.workoutType)} ${
        isPast && workout.status === "planned" ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }}
          />
          <span className="text-sm font-medium text-gray-200">
            {workout.title}
          </span>
          {statusIcon(workout.status) && (
            <span className="text-xs">{statusIcon(workout.status)}</span>
          )}
        </div>
        <span className="text-xs text-gray-500">{formatDate(workout.date)}</span>
      </div>

      {!isRest && (
        <div className="flex items-center gap-3 mt-1 ml-4 text-xs text-gray-400">
          {workout.targetDistanceKm && (
            <span>{workout.targetDistanceKm}km</span>
          )}
          {workout.targetPace && <span>{workout.targetPace}</span>}
          {workout.targetDurationMin && <span>{workout.targetDurationMin}min</span>}
        </div>
      )}

      {workout.description && !isRest && (
        <p className="text-[11px] text-gray-500 mt-1 ml-4 line-clamp-2">
          {workout.description}
        </p>
      )}

      {/* Matched activity */}
      {workout.matchedActivity && (
        <div className="mt-1.5 ml-4 bg-gray-800/60 rounded px-2 py-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-green-400 font-medium truncate">
              {workout.matchedActivity.name}
            </span>
            <div className="flex items-center gap-2 text-gray-400 flex-shrink-0">
              {workout.matchedActivity.distanceKm && (
                <span>{workout.matchedActivity.distanceKm.toFixed(1)}km</span>
              )}
              {workout.matchedActivity.avgPacePerKm && (
                <span>{workout.matchedActivity.avgPacePerKm}</span>
              )}
              {workout.matchedActivity.avgHeartRate && (
                <span>{workout.matchedActivity.avgHeartRate}bpm</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskChecklist({
  tasks,
  onToggle,
}: {
  tasks: WeeklyTask[];
  onToggle: (id: string, status: string) => void;
}) {
  if (tasks.length === 0) return null;

  const categoryIcons: Record<string, string> = {
    strength: "\ud83d\udcaa",
    mobility: "\ud83e\uddd8",
    nutrition: "\ud83e\udd66",
    recovery: "\ud83d\udca4",
    other: "\u2705",
  };

  return (
    <div className="mt-2 space-y-1">
      {tasks.map((t) => (
        <button
          key={t.id}
          onClick={() => onToggle(t.id, t.status === "done" ? "pending" : "done")}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900/50 border border-gray-800/40 hover:bg-gray-800/50 transition-colors text-left"
        >
          <span className={`text-xs ${t.status === "done" ? "text-green-400" : "text-gray-600"}`}>
            {t.status === "done" ? "\u2611" : "\u2610"}
          </span>
          <span className="text-xs">{categoryIcons[t.category] || "\u2705"}</span>
          <span className={`text-xs flex-1 ${t.status === "done" ? "text-gray-500 line-through" : "text-gray-300"}`}>
            {t.description}
          </span>
        </button>
      ))}
    </div>
  );
}

function WeekView({
  weekNumber,
  workouts,
  phase,
  tasks,
  onToggleTask,
}: {
  weekNumber: number;
  workouts: Workout[];
  phase: Phase | null;
  tasks: WeeklyTask[];
  onToggleTask: (id: string, status: string) => void;
}) {
  const weekKm = workouts.reduce(
    (sum, w) => sum + (w.targetDistanceKm || 0),
    0
  );
  const actualKm = workouts.reduce(
    (sum, w) =>
      sum + (w.matchedActivity?.distanceKm || 0),
    0
  );

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-300">
            Week {weekNumber}
          </span>
          {phase && (
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              {phase.name}
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {weekKm > 0 && (
            <>
              {actualKm > 0 ? (
                <span>
                  <span className="text-gray-300">{actualKm.toFixed(1)}</span> / {weekKm.toFixed(0)} km
                </span>
              ) : (
                <span>{weekKm.toFixed(0)} km planned</span>
              )}
            </>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {workouts.map((w) => (
          <WorkoutCard key={w.id} workout={w} />
        ))}
      </div>
      <TaskChecklist tasks={tasks} onToggle={onToggleTask} />
    </div>
  );
}

function Legend() {
  const types = [
    { type: "easy", label: "Easy" },
    { type: "long", label: "Long" },
    { type: "tempo", label: "Tempo" },
    { type: "interval", label: "Interval" },
    { type: "race_pace", label: "Race Pace" },
    { type: "strength", label: "Strength" },
    { type: "rest", label: "Rest" },
    { type: "race", label: "Race" },
  ];

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {types.map((t) => (
        <div key={t.type} className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: getWorkoutTypeColor(t.type) }}
          />
          <span className="text-xs text-gray-500">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
          <Nav />
          <div className="text-gray-500 text-center py-12">Loading...</div>
        </main>
      }
    >
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
    fetch("/api/plan")
      .then((r) => r.json())
      .then((data) => setPlan(data.plan))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Handle ?new=1 param — auto-start plan creation
  useEffect(() => {
    if (searchParams.get("new") === "1" && !loading) {
      handleNewPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function handleNewPlan() {
    setStartingPlan(true);
    try {
      const res = await fetch("/api/plan/new-plan-session", { method: "POST" });
      const data = await res.json();
      router.push(`/chat/${data.id}`);
    } catch {
      setStartingPlan(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <Nav />
        <div className="text-gray-500 text-center py-12">Loading...</div>
      </main>
    );
  }

  if (!plan) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <Nav />
        <div className="text-center py-16">
          <p className="text-5xl mb-4">&#x1F966;</p>
          <p className="text-gray-400 text-lg font-medium">No training plan yet</p>
          <p className="text-gray-500 text-sm mt-2 mb-4">
            Let Brocco build you a personalized plan.
          </p>
          <button
            onClick={handleNewPlan}
            disabled={startingPlan}
            className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
          >
            {startingPlan ? "Starting..." : "Build a new plan"}
          </button>
        </div>
      </main>
    );
  }

  // Group workouts by week
  const weekMap = new Map<number, Workout[]>();
  for (const w of plan.workouts) {
    if (!weekMap.has(w.weekNumber)) weekMap.set(w.weekNumber, []);
    weekMap.get(w.weekNumber)!.push(w);
  }
  const weeks = Array.from(weekMap.entries()).sort(([a], [b]) => a - b);

  // Group tasks by week
  const taskMap = new Map<number, WeeklyTask[]>();
  for (const t of plan.weeklyTasks || []) {
    if (!taskMap.has(t.weekNumber)) taskMap.set(t.weekNumber, []);
    taskMap.get(t.weekNumber)!.push(t);
  }

  async function handleToggleTask(id: string, status: string) {
    // Optimistic update
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        weeklyTasks: prev.weeklyTasks.map((t) =>
          t.id === id ? { ...t, status } : t
        ),
      };
    });
    await fetch("/api/plan/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  }

  // Find current week
  const today = new Date().toISOString().split("T")[0];
  const currentWeekNum = plan.workouts.find(
    (w) => w.date.split("T")[0] >= today
  )?.weekNumber;

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6 pb-20">
      <Nav />

      {/* Plan header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">{plan.name}</h1>
          <button
            onClick={handleNewPlan}
            disabled={startingPlan}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {startingPlan ? "Starting..." : "New Plan"}
          </button>
        </div>
        <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
          {plan.goal && <span>{plan.goal}</span>}
          {plan.raceDate && (
            <span>
              Race: {new Date(plan.raceDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          )}
        </div>
        {/* Phase timeline */}
        {plan.phases.length > 0 && (
          <div className="flex gap-1 mt-3">
            {plan.phases.map((phase) => {
              const totalWeeks = weeks.length || 1;
              const phaseWeeks = phase.endWeek - phase.startWeek + 1;
              const widthPct = (phaseWeeks / totalWeeks) * 100;
              return (
                <div
                  key={phase.id}
                  className="rounded-full h-2 bg-gray-700 relative overflow-hidden"
                  style={{ width: `${widthPct}%` }}
                  title={`${phase.name} (Weeks ${phase.startWeek}-${phase.endWeek})`}
                >
                  {currentWeekNum !== undefined &&
                    currentWeekNum >= phase.startWeek &&
                    currentWeekNum <= phase.endWeek && (
                      <div
                        className="absolute inset-y-0 left-0 bg-green-500 rounded-full"
                        style={{
                          width: `${((currentWeekNum - phase.startWeek + 1) / phaseWeeks) * 100}%`,
                        }}
                      />
                    )}
                </div>
              );
            })}
          </div>
        )}
        {plan.phases.length > 0 && (
          <div className="flex gap-1 mt-1">
            {plan.phases.map((phase) => {
              const totalWeeks = weeks.length || 1;
              const phaseWeeks = phase.endWeek - phase.startWeek + 1;
              const widthPct = (phaseWeeks / totalWeeks) * 100;
              return (
                <div key={phase.id} style={{ width: `${widthPct}%` }}>
                  <span className="text-[10px] text-gray-500 truncate block">
                    {phase.name}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Legend />

      {/* Weeks */}
      {weeks.map(([weekNum, workouts]) => {
        const phase = plan.phases.find(
          (p) => weekNum >= p.startWeek && weekNum <= p.endWeek
        ) || null;
        const isCurrentWeek = weekNum === currentWeekNum;
        return (
          <div
            key={weekNum}
            className={isCurrentWeek ? "ring-1 ring-green-500/30 rounded-xl p-3 -mx-3 mb-4" : ""}
          >
            {isCurrentWeek && (
              <div className="text-xs text-green-400 mb-2 font-medium">Current Week</div>
            )}
            <WeekView
              weekNumber={weekNum}
              workouts={workouts}
              phase={phase}
              tasks={taskMap.get(weekNum) || []}
              onToggleTask={handleToggleTask}
            />
          </div>
        );
      })}
    </main>
  );
}

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
