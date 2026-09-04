"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PageHeader } from "../nav";
import { emitToast } from "@/lib/toast";
import {
  presetsForSport,
  buildCustomInterval,
  estimateDurationMin,
  describeDefinition,
  fillTemplate,
  type WorkoutDefinition,
} from "@/lib/guided-workout";
import { artPathFor } from "@/lib/exercise-art";
import { useT, useLang } from "@/app/features-provider";
import { fmtDate, type Lang } from "@/lib/i18n";
import type { DictKey } from "@/lib/dict";
import WorkoutPlayer from "./player";

interface SavedWorkout {
  id: string;
  title: string;
  focus: string | null;
  durationMin: number;
  source: string;
  plannedDate: string | null;
  timesCompleted: number;
  pinned: boolean;
  createdAt: string;
}

interface RecentSession {
  id: string;
  finishedAt: string;
  completed: boolean;
  bailedAtExercise: number | null;
  durationMin: number;
}

interface ActiveWorkout {
  title: string;
  definition: WorkoutDefinition;
  workoutId: string | null;
}

/** Everything the preview sheet needs — saved workouts carry extras. */
interface PreviewData {
  workoutId: string | null;
  title: string;
  focus: string | null;
  definition: WorkoutDefinition;
  source?: string;
  pinned?: boolean;
  timesCompleted?: number;
  recentSessions?: RecentSession[];
}

function fmtSec(sec: number, min: string): string {
  return sec >= 60 && sec % 60 === 0 ? `${sec / 60} ${min}` : `${sec}s`;
}

function fmtSessionDate(iso: string, lang: Lang): string {
  return fmtDate(iso, lang, { day: "numeric", month: "short" });
}

/**
 * The "see it before you start it" sheet: full block/exercise breakdown,
 * per-block round steppers (local only — the saved definition is untouched),
 * recent history, and the start / adjust-with-Brocco / pin / delete actions.
 */
function WorkoutPreview({
  data,
  onStart,
  onClose,
  onPinToggle,
  onDelete,
}: {
  data: PreviewData;
  onStart: (def: WorkoutDefinition, title: string, workoutId: string | null) => void;
  onClose: () => void;
  onPinToggle: (id: string, pinned: boolean) => void;
  onDelete: (id: string, title: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const min = t("common.min");
  const [rounds, setRounds] = useState<number[]>(data.definition.blocks.map((b) => b.rounds));

  // The definition actually played — the stepper tweaks live only here.
  const effectiveDef = useMemo<WorkoutDefinition>(
    () => ({
      ...data.definition,
      blocks: data.definition.blocks.map((b, i) => ({ ...b, rounds: rounds[i] ?? b.rounds })),
    }),
    [data.definition, rounds]
  );
  const scaled = data.definition.blocks.some((b, i) => (rounds[i] ?? b.rounds) !== b.rounds);

  const adjustMsg =
    `${t("workout.adjustIntro")}: "${data.title}"${data.focus ? ` (${t("workout.focusLabel")}: ${data.focus})` : ""}.\n\n` +
    `${describeDefinition(data.definition, lang)}\n\n` +
    t("workout.adjustPrompt");

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto bg-paper border-t-2 border-ink rounded-t-2xl px-4 pt-4 pb-6 safe-bottom">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold text-ink">{data.title}</h2>
              <p className="text-xs text-moss font-semibold">
                ~{estimateDurationMin(effectiveDef)} {min}
                {data.focus ? ` · ${data.focus}` : ""}
                {data.timesCompleted ? ` · ${fillTemplate(t("workout.doneTimes"), { n: data.timesCompleted })}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {data.workoutId && (
                <button
                  onClick={() => onPinToggle(data.workoutId!, !data.pinned)}
                  className={`text-lg ${data.pinned ? "" : "opacity-30"}`}
                  title={data.pinned ? t("workout.unpin") : t("workout.pinToTop")}
                  aria-label={data.pinned ? t("workout.unpin") : t("workout.pinToTop")}
                >
                  📌
                </button>
              )}
              <button onClick={onClose} className="text-moss hover:text-ink text-xl leading-none" aria-label={t("common.close")}>
                &times;
              </button>
            </div>
          </div>

          {/* The session, laid out */}
          <div className="space-y-2 mt-3">
            {data.definition.warmupSec ? (
              <p className="text-xs font-bold text-moss">🔥 {t("workout.warmUp")} · {fmtSec(data.definition.warmupSec, min)}</p>
            ) : null}

            {data.definition.blocks.map((b, bi) => (
              <div key={bi} className="sticker px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-xs font-extrabold text-ink">
                    {b.label || `${t("workout.block")} ${bi + 1}`}
                    {b.restBetweenRoundsSec ? (
                      <span className="text-sage font-bold"> · {fmtSec(b.restBetweenRoundsSec, min)} {t("workout.betweenRounds")}</span>
                    ) : null}
                  </p>
                  {/* Short on time? Rounds are the honest lever. */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setRounds((r) => r.map((n, i) => (i === bi ? Math.max(1, n - 1) : n)))}
                      className="w-6 h-6 flex items-center justify-center bg-ghost border-2 border-ink rounded-md text-xs font-extrabold sticker-press"
                      aria-label={t("workout.fewerRounds")}
                    >
                      −
                    </button>
                    <span className="text-xs font-extrabold text-ink tabular-nums w-14 text-center">
                      {rounds[bi] ?? b.rounds} {(rounds[bi] ?? b.rounds) === 1 ? t("workout.round") : t("workout.roundsPlural")}
                    </span>
                    <button
                      onClick={() => setRounds((r) => r.map((n, i) => (i === bi ? Math.min(50, n + 1) : n)))}
                      className="w-6 h-6 flex items-center justify-center bg-ghost border-2 border-ink rounded-md text-xs font-extrabold sticker-press"
                      aria-label={t("workout.moreRounds")}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  {b.exercises.map((e, ei) => (
                    <div key={ei} className="flex items-center gap-2">
                      {artPathFor(e.name, e.art) && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={artPathFor(e.name, e.art)!} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
                      )}
                      <p className="text-xs font-bold text-ink flex-1 min-w-0">{e.name}</p>
                      <p className="text-[10px] text-sage font-bold tabular-nums flex-shrink-0">
                        {e.mode === "time" ? fmtSec(e.workSec!, min) : `${e.reps} ${t("common.reps")}`}
                        {e.restSec ? ` · ${t("common.rest")} ${fmtSec(e.restSec, min)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
                {b.exercises.some((e) => e.note) && (
                  <div className="mt-1.5 pt-1.5 border-t border-dashed border-shade space-y-0.5">
                    {b.exercises
                      .filter((e) => e.note)
                      .map((e, i) => (
                        <p key={i} className="text-[10px] text-moss font-semibold">
                          <span className="font-extrabold">{e.name}:</span> {e.note}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            ))}

            {data.definition.cooldownSec ? (
              <p className="text-xs font-bold text-moss">🧊 {t("workout.coolDown")} · {fmtSec(data.definition.cooldownSec, min)}</p>
            ) : null}
          </div>

          {/* History */}
          {data.recentSessions && data.recentSessions.length > 0 && (
            <div className="mt-3">
              <p className="label-xs mb-1">{t("workout.history")}</p>
              <div className="space-y-0.5">
                {data.recentSessions.map((s) => (
                  <p key={s.id} className="text-xs font-semibold tabular-nums">
                    <span className="text-moss">{fmtSessionDate(s.finishedAt, lang)}</span>
                    <span className="text-sage"> · {s.durationMin} {min} · </span>
                    {s.completed ? (
                      <span className="text-leaf">{t("workout.completed")}</span>
                    ) : (
                      <span className="text-clay">{t("workout.stoppedAfter")} {s.bailedAtExercise ?? 0} {(s.bailedAtExercise ?? 0) === 1 ? t("workout.exercise") : t("workout.exercisesPlural")}</span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 space-y-2">
            <button
              onClick={() => onStart(effectiveDef, data.title, data.workoutId)}
              className="btn-brocco w-full py-3"
            >
              {scaled ? t("workout.startAdjusted") : t("common.start")} ▶
            </button>
            <div className="flex gap-2">
              <Link
                href={`/chat?draft=${encodeURIComponent(adjustMsg)}`}
                className="btn-quiet flex-1 py-2 text-xs text-center"
              >
                🥦 {t("workout.adjustWithBrocco")}
              </Link>
              {data.workoutId && (
                <button
                  onClick={() => onDelete(data.workoutId!, data.title)}
                  className="btn-quiet px-4 py-2 text-xs text-clay"
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomIntervalForm({ onStart }: { onStart: (def: WorkoutDefinition, title: string) => void }) {
  const t = useT();
  const lang = useLang();
  const [work, setWork] = useState(40);
  const [rest, setRest] = useState(20);
  const [rounds, setRounds] = useState(10);

  const numCls = "field text-center";

  return (
    <div className="sticker p-4">
      <p className="text-sm font-bold text-ink mb-3">{t("workout.customIntervals")}</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className="label-xs block mb-1 text-center">{t("workout.work")}</label>
          <input type="number" min={5} max={600} value={work} onChange={(e) => setWork(Number(e.target.value))} className={numCls} />
        </div>
        <div>
          <label className="label-xs block mb-1 text-center">{t("workout.restSec")}</label>
          <input type="number" min={0} max={600} value={rest} onChange={(e) => setRest(Number(e.target.value))} className={numCls} />
        </div>
        <div>
          <label className="label-xs block mb-1 text-center">{t("workout.rounds")}</label>
          <input type="number" min={1} max={50} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className={numCls} />
        </div>
      </div>
      <button
        onClick={() => onStart(buildCustomInterval(work, rest, rounds, lang), `${t("workout.intervals")} ${work}/${rest} × ${rounds}`)}
        className="btn-quiet w-full py-2.5 text-sm"
      >
        {t("common.start")}
      </button>
    </div>
  );
}

/** A plan-generated session is "fresh" while its day is near; after that it's clutter. */
function isFreshPlanWorkout(w: SavedWorkout, todayIso: string): boolean {
  if (w.plannedDate) {
    const weekAgo = new Date(new Date(`${todayIso}T00:00:00`).getTime() - 7 * 86400000)
      .toISOString()
      .slice(0, 10);
    return w.plannedDate >= weekAgo;
  }
  // Planned workout deleted (week promotion) — fall back to creation age.
  return Date.now() - new Date(w.createdAt).getTime() < 14 * 86400000;
}

function SavedWorkoutRow({
  w,
  onOpen,
  onStart,
}: {
  w: SavedWorkout;
  onOpen: () => void;
  onStart: () => void;
}) {
  const t = useT();
  return (
    <div className="group flex items-center gap-3 sticker px-4 py-3">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          {w.pinned && <span className="text-xs flex-shrink-0">📌</span>}
          <p className="text-sm font-bold text-ink truncate">{w.title}</p>
          {w.source === "plan" && (
            <span className="text-[9px] uppercase font-extrabold text-moss bg-ghost px-1.5 py-0.5 rounded flex-shrink-0">{t("workout.planBadge")}</span>
          )}
        </div>
        <p className="text-xs text-moss font-semibold">
          ~{w.durationMin} {t("common.min")}{w.focus ? ` · ${w.focus}` : ""}{w.timesCompleted > 0 ? ` · ${fillTemplate(t("workout.doneTimes"), { n: w.timesCompleted })}` : ""}
        </p>
      </button>
      <button onClick={onStart} className="btn-brocco px-3 py-1.5 text-xs flex-shrink-0">
        {t("common.start")}
      </button>
    </div>
  );
}

function WorkoutViewInner() {
  const t = useT();
  const lang = useLang();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [saved, setSaved] = useState<SavedWorkout[]>([]);
  const [primarySport, setPrimarySport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<ActiveWorkout | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [showStalePlan, setShowStalePlan] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null); // status text while Brocco builds

  const fetchSaved = useCallback(() => {
    fetch("/api/guided-workouts")
      .then((r) => r.json())
      .then((d) => {
        setSaved(d.workouts || []);
        setPrimarySport(d.primarySport || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSaved();
  }, [fetchSaved]);

  const presets = useMemo(() => presetsForSport(primarySport, lang), [primarySport, lang]);

  const loadSaved = useCallback(async (id: string): Promise<PreviewData | null> => {
    try {
      const res = await fetch(`/api/guided-workouts/${id}`);
      if (!res.ok) throw new Error();
      const { workout } = await res.json();
      return {
        workoutId: workout.id,
        title: workout.title,
        focus: workout.focus,
        definition: workout.definition,
        source: workout.source,
        pinned: workout.pinned,
        timesCompleted: workout.timesCompleted,
        recentSessions: workout.recentSessions,
      };
    } catch {
      emitToast({ text: t("workout.couldntLoad"), kind: "error" });
      return null;
    }
  }, []);

  const startSaved = useCallback(
    async (id: string) => {
      const data = await loadSaved(id);
      if (data) setActive({ title: data.title, definition: data.definition, workoutId: data.workoutId });
    },
    [loadSaved]
  );

  const openSaved = useCallback(
    async (id: string) => {
      const data = await loadSaved(id);
      if (data) setPreview(data);
    },
    [loadSaved]
  );

  // Deep links: ?start=<id> (from chat/toast) and ?planned=<id> (from Today/plan)
  useEffect(() => {
    const startId = searchParams.get("start");
    const plannedId = searchParams.get("planned");
    if (startId) {
      router.replace("/workout");
      startSaved(startId);
    } else if (plannedId) {
      router.replace("/workout");
      setGenerating(t("workout.building"));
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
        .catch(() => emitToast({ text: t("workout.couldntBuild"), kind: "error" }))
        .finally(() => setGenerating(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function togglePin(id: string, pinned: boolean) {
    const res = await fetch(`/api/guided-workouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (res.ok) {
      setPreview((p) => (p && p.workoutId === id ? { ...p, pinned } : p));
      fetchSaved();
    }
  }

  async function deleteSaved(id: string, title: string) {
    // Grab the full definition first so undo can restore it
    const full = await fetch(`/api/guided-workouts/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const res = await fetch(`/api/guided-workouts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      emitToast({ text: t("workout.couldntDelete"), kind: "error" });
      return;
    }
    setPreview(null);
    fetchSaved();
    if (full?.workout) {
      emitToast({
        text: `${t("workout.deleted")}: ${title}`,
        kind: "info",
        action: {
          label: t("common.undo"),
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

  // Local-calendar date, not toISOString() — west of UTC that slips a day.
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const ownWorkouts = saved.filter((w) => w.source !== "plan");
  const planWorkouts = saved.filter((w) => w.source === "plan");
  const freshPlan = planWorkouts.filter((w) => isFreshPlanWorkout(w, todayIso));
  const stalePlan = planWorkouts.filter((w) => !isFreshPlanWorkout(w, todayIso));

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4">
      <PageHeader title={t("workout.title")} />

      {generating && (
        <div className="mt-4 bg-sprout border-2 border-ink rounded-xl px-4 py-3 flex items-center gap-3 shadow-[2px_2px_0_var(--color-shade)]">
          <span className="text-xl animate-pulse">🥦</span>
          <p className="text-sm text-ink font-semibold">{generating}</p>
        </div>
      )}

      <div className="mt-4 space-y-5 pb-8">
        {/* Ask Brocco */}
        <Link
          href={`/chat?msg=${encodeURIComponent(t("workout.askForToday"))}`}
          className="btn-brocco flex items-center gap-3 px-4 py-3"
        >
          <span className="text-xl">💬</span>
          <div className="flex-1 text-left">
            <p className="text-sm font-extrabold">{t("workout.askBrocco")}</p>
            <p className="text-xs text-leaf font-bold">{t("workout.askBroccoSub")}</p>
          </div>
        </Link>

        {/* Presets */}
        <section>
          <h2 className="label-xs mb-2">{t("workout.quickStart")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() =>
                  setPreview({ workoutId: null, title: p.title, focus: p.focus, definition: p.definition })
                }
                className="sticker sticker-press text-left px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span>{p.emoji}</span>
                  <p className="text-sm font-bold text-ink">{p.title}</p>
                  <span className="ml-auto text-[10px] text-sage font-bold tabular-nums">~{estimateDurationMin(p.definition)} {t("common.min")}</span>
                </div>
                <p className="text-xs text-moss font-semibold">{p.description}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Custom intervals */}
        <CustomIntervalForm onStart={(def, title) => setActive({ title, definition: def, workoutId: null })} />

        {/* Saved workouts */}
        <section>
          <h2 className="label-xs mb-2">{t("workout.yourWorkouts")}</h2>
          {loading ? (
            <p className="text-sm text-moss font-semibold text-center py-4">{t("common.loading")}</p>
          ) : ownWorkouts.length === 0 && planWorkouts.length === 0 ? (
            <p className="text-xs text-sage font-semibold text-center py-4">
              {t("workout.nothingSaved")}
            </p>
          ) : (
            <div className="space-y-2">
              {ownWorkouts.map((w) => (
                <SavedWorkoutRow key={w.id} w={w} onOpen={() => openSaved(w.id)} onStart={() => startSaved(w.id)} />
              ))}
            </div>
          )}
        </section>

        {/* Plan-generated sessions, current ones only — the rest is archive */}
        {(freshPlan.length > 0 || stalePlan.length > 0) && (
          <section>
            <h2 className="label-xs mb-2">{t("workout.fromPlan")}</h2>
            <div className="space-y-2">
              {freshPlan.map((w) => (
                <SavedWorkoutRow key={w.id} w={w} onOpen={() => openSaved(w.id)} onStart={() => startSaved(w.id)} />
              ))}
              {showStalePlan &&
                stalePlan.map((w) => (
                  <SavedWorkoutRow key={w.id} w={w} onOpen={() => openSaved(w.id)} onStart={() => startSaved(w.id)} />
                ))}
            </div>
            {stalePlan.length > 0 && (
              <button
                onClick={() => setShowStalePlan((v) => !v)}
                className="text-xs text-sage font-bold mt-2 hover:text-ink"
              >
                {showStalePlan ? t("workout.hideOlder") : `${t("workout.showOlder")} (${stalePlan.length})`}
              </button>
            )}
          </section>
        )}
      </div>

      {preview && (
        <WorkoutPreview
          data={preview}
          onClose={() => setPreview(null)}
          onStart={(def, title, workoutId) => {
            setPreview(null);
            setActive({ title, definition: def, workoutId });
          }}
          onPinToggle={togglePin}
          onDelete={deleteSaved}
        />
      )}
    </main>
  );
}

export default function WorkoutView() {
  return (
    // Fallback renders before the provider resolves, so it stays untranslated.
    <Suspense fallback={<main className="min-h-screen max-w-2xl mx-auto px-4"><PageHeader /></main>}>
      <WorkoutViewInner />
    </Suspense>
  );
}
