"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PageHeader } from "../nav";
import { emitToast } from "@/lib/toast";
import {
  PRESET_WORKOUTS,
  buildCustomInterval,
  estimateDurationMin,
  type WorkoutDefinition,
} from "@/lib/guided-workout";
import WorkoutPlayer from "./player";

interface SavedWorkout {
  id: string;
  title: string;
  focus: string | null;
  durationMin: number;
  source: string;
  timesCompleted: number;
}

interface ActiveWorkout {
  title: string;
  definition: WorkoutDefinition;
  workoutId: string | null;
}

function CustomIntervalForm({ onStart }: { onStart: (def: WorkoutDefinition, title: string) => void }) {
  const [work, setWork] = useState(40);
  const [rest, setRest] = useState(20);
  const [rounds, setRounds] = useState(10);

  const numCls = "w-full px-2 py-2 bg-gray-950 border border-gray-700 rounded-lg text-sm text-white text-center focus:outline-none focus:ring-1 focus:ring-green-500";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-200 mb-3">⏱ Custom intervals</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1 text-center">Work (s)</label>
          <input type="number" min={5} max={600} value={work} onChange={(e) => setWork(Number(e.target.value))} className={numCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1 text-center">Rest (s)</label>
          <input type="number" min={0} max={600} value={rest} onChange={(e) => setRest(Number(e.target.value))} className={numCls} />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase mb-1 text-center">Rounds</label>
          <input type="number" min={1} max={50} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className={numCls} />
        </div>
      </div>
      <button
        onClick={() => onStart(buildCustomInterval(work, rest, rounds), `Intervals ${work}/${rest} × ${rounds}`)}
        className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium rounded-xl transition-colors"
      >
        Start
      </button>
    </div>
  );
}

function WorkoutViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [saved, setSaved] = useState<SavedWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [generating, setGenerating] = useState<string | null>(null); // status text while Brocco builds

  const fetchSaved = useCallback(() => {
    fetch("/api/guided-workouts")
      .then((r) => r.json())
      .then((d) => setSaved(d.workouts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const startSaved = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/guided-workouts/${id}`);
      if (!res.ok) throw new Error();
      const { workout } = await res.json();
      setActive({ title: workout.title, definition: workout.definition, workoutId: workout.id });
    } catch {
      emitToast({ text: "Couldn't load that workout.", kind: "error" });
    }
  }, []);

  // Deep links: ?start=<id> (from chat/toast) and ?planned=<id> (from Today/plan)
  useEffect(() => {
    const startId = searchParams.get("start");
    const plannedId = searchParams.get("planned");
    if (startId) {
      router.replace("/workout");
      startSaved(startId);
    } else if (plannedId) {
      router.replace("/workout");
      setGenerating("Brocco is building your session…");
      fetch("/api/guided-workouts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannedWorkoutId: plannedId }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "failed");
          const { workout } = await r.json();
          fetchSaved();
          return startSaved(workout.id);
        })
        .catch(() => emitToast({ text: "Couldn't build the session — try a preset instead.", kind: "error" }))
        .finally(() => setGenerating(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function deleteSaved(w: SavedWorkout) {
    // Grab the full definition first so undo can restore it
    const full = await fetch(`/api/guided-workouts/${w.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const res = await fetch(`/api/guided-workouts/${w.id}`, { method: "DELETE" });
    if (!res.ok) {
      emitToast({ text: "Couldn't delete — try again.", kind: "error" });
      return;
    }
    fetchSaved();
    if (full?.workout) {
      emitToast({
        text: `Deleted: ${w.title}`,
        kind: "info",
        action: {
          label: "Undo",
          run: async () => {
            await fetch("/api/guided-workouts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: full.workout.title, focus: full.workout.focus, definition: full.workout.definition }),
            });
            fetchSaved();
          },
        },
      });
    }
  }

  if (active) {
    return (
      <WorkoutPlayer
        title={active.title}
        definition={active.definition}
        workoutId={active.workoutId}
        onExit={() => {
          setActive(null);
          fetchSaved();
        }}
      />
    );
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title="Workouts" />

      {generating && (
        <div className="mt-4 bg-green-900/20 border border-green-800/40 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-xl animate-pulse">🥦</span>
          <p className="text-sm text-gray-200">{generating}</p>
        </div>
      )}

      <div className="mt-4 space-y-5 pb-8">
        {/* Ask Brocco */}
        <Link
          href={`/chat?msg=${encodeURIComponent("Make me a workout for today")}`}
          className="flex items-center gap-3 bg-green-600/90 hover:bg-green-600 border border-green-500/30 rounded-xl px-4 py-3 transition-colors"
        >
          <span className="text-xl">💬</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Ask Brocco for a workout</p>
            <p className="text-xs text-green-200/70">Tell it your time, focus, and equipment — get a playable session</p>
          </div>
        </Link>

        {/* Presets */}
        <section>
          <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Quick start</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PRESET_WORKOUTS.map((p) => (
              <button
                key={p.key}
                onClick={() => setActive({ title: p.title, definition: p.definition, workoutId: null })}
                className="text-left bg-gray-900 border border-gray-800 hover:border-gray-700 rounded-xl px-4 py-3 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span>{p.emoji}</span>
                  <p className="text-sm font-medium text-gray-100">{p.title}</p>
                  <span className="ml-auto text-[10px] text-gray-600">~{estimateDurationMin(p.definition)} min</span>
                </div>
                <p className="text-xs text-gray-500">{p.description}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Custom intervals */}
        <CustomIntervalForm onStart={(def, title) => setActive({ title, definition: def, workoutId: null })} />

        {/* Saved workouts */}
        <section>
          <h2 className="text-[10px] font-bold text-gray-600 uppercase tracking-widest mb-2">Your workouts</h2>
          {loading ? (
            <p className="text-sm text-gray-600 text-center py-4">Loading…</p>
          ) : saved.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-4">
              Nothing saved yet — ask Brocco for a workout and it lands here.
            </p>
          ) : (
            <div className="space-y-2">
              {saved.map((w) => (
                <div key={w.id} className="group flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
                  <button onClick={() => startSaved(w.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-100 truncate">{w.title}</p>
                      {w.source === "plan" && (
                        <span className="text-[9px] uppercase font-bold text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded flex-shrink-0">plan</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">
                      ~{w.durationMin} min{w.focus ? ` · ${w.focus}` : ""}{w.timesCompleted > 0 ? ` · done ${w.timesCompleted}×` : ""}
                    </p>
                  </button>
                  <button
                    onClick={() => startSaved(w.id)}
                    className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg flex-shrink-0 transition-colors"
                  >
                    Start
                  </button>
                  <button
                    onClick={() => deleteSaved(w)}
                    aria-label={`Delete ${w.title}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-600 hover:text-red-400 transition-all px-1"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function WorkoutView() {
  return (
    <Suspense fallback={<main className="min-h-screen max-w-2xl mx-auto px-4"><PageHeader title="Workouts" /></main>}>
      <WorkoutViewInner />
    </Suspense>
  );
}
