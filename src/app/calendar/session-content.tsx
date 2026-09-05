"use client";

import { useEffect, useState } from "react";
import { useT, useFmt } from "@/app/features-provider";
import { artPathFor } from "@/lib/exercise-art";
import type { WorkoutBlock, WorkoutDefinition, WorkoutExercise } from "@/lib/guided-workout";

/** What GET /api/guided-workouts?plannedWorkoutId= hands back for one session. */
export interface LinkedSession {
  id: string;
  title: string;
  focus: string | null;
  durationMin: number | null;
  kind: "sc" | "yoga";
  definition: WorkoutDefinition;
}

/** undefined = still loading, null = nothing linked yet (or the request failed). */
export type LinkedSessionState = LinkedSession | null | undefined;

/**
 * The guided session Brocco built for a plan entry, fetched once per card.
 * The calendar's range endpoint doesn't carry it (it is a separate table with
 * a soft link), so each strength/yoga card asks for its own on first render.
 */
export function useLinkedSession(plannedWorkoutId: string, enabled: boolean): LinkedSessionState {
  // Keyed by id so a card re-pointed at another workout reads as "loading"
  // again without a synchronous reset inside the effect.
  const [result, setResult] = useState<{ id: string; session: LinkedSession | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/guided-workouts?plannedWorkoutId=${encodeURIComponent(plannedWorkoutId)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { workout: null }))
      .then((data) => {
        const w = data?.workout;
        setResult({ id: plannedWorkoutId, session: w && Array.isArray(w.definition?.blocks) ? (w as LinkedSession) : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ id: plannedWorkoutId, session: null });
      });
    return () => controller.abort();
  }, [plannedWorkoutId, enabled]);
  if (!enabled) return null;
  return result?.id === plannedWorkoutId ? result.session : undefined;
}

/** Collapse to the first block once the full list would run past this many rows. */
const COLLAPSE_AFTER = 8;

/** "40s" / "×12" — the amount the player will count for this exercise. */
function exerciseAmount(e: WorkoutExercise): string {
  return e.mode === "reps" ? `×${e.reps ?? 1}` : `${e.workSec ?? 0}s`;
}

function ExerciseRow({ exercise, yoga }: { exercise: WorkoutExercise; yoga: boolean }) {
  const art = artPathFor(exercise.name, exercise.art);
  return (
    <div className="flex items-center gap-2 py-1">
      {art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" width={32} height={32} className="w-8 h-8 flex-shrink-0 rounded-md border border-shade bg-paper object-contain" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-ink leading-tight truncate">{exercise.name}</p>
        {exercise.note && (
          <p className={`text-[10px] font-semibold leading-tight ${yoga ? "text-moss" : "text-sage"} truncate`}>{exercise.note}</p>
        )}
      </div>
      <span className="text-xs font-extrabold text-moss tabular-nums flex-shrink-0">{exerciseAmount(exercise)}</span>
    </div>
  );
}

function BlockSection({ block, index, yoga }: { block: WorkoutBlock; index: number; yoga: boolean }) {
  const t = useT();
  const fmt = useFmt();
  const rounds = block.rounds || 1;
  return (
    <div className="py-1">
      <p className="text-xs font-extrabold text-ink flex items-baseline gap-1.5">
        <span className="truncate">{block.label || `${t("workout.block")} ${index + 1}`}</span>
        {rounds > 1 && (
          <span className="text-moss font-bold tabular-nums flex-shrink-0">
            · {fmt.plural(rounds, t("calendar.roundsOne"), t("calendar.roundsMany")).replace("{n}", String(rounds))}
          </span>
        )}
      </p>
      <div className="pl-3 border-l-2 border-shade ml-1">
        {block.exercises.map((e, i) => <ExerciseRow key={i} exercise={e} yoga={yoga} />)}
      </div>
    </div>
  );
}

/**
 * "What's in it": the blocks and exercises of the linked guided session, the
 * same list the coach sees, so the athlete knows what they're in for without
 * opening the player. Long sessions fold to the first block behind a toggle.
 */
export function SessionContent({ session }: { session: LinkedSession }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const blocks = session.definition.blocks || [];
  const yoga = session.kind === "yoga" || session.definition.kind === "yoga";
  const total = blocks.reduce((n, b) => n + b.exercises.length, 0);
  const collapsible = blocks.length > 1 && total > COLLAPSE_AFTER;
  const shown = collapsible && !expanded ? blocks.slice(0, 1) : blocks;
  const hidden = total - shown.reduce((n, b) => n + b.exercises.length, 0);
  if (!blocks.length) return null;

  return (
    <div>
      <p className="label-xs">{t("calendar.whatsInIt")}</p>
      <div className="mt-1 border-2 border-shade rounded-xl px-2.5 py-1 bg-paper">
        {shown.map((b, i) => <BlockSection key={i} block={b} index={i} yoga={yoga} />)}
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full text-left text-xs font-bold text-moss py-1.5 border-t border-dotted border-shade"
          >
            {expanded ? t("calendar.showLess") : t("calendar.showAll").replace("{n}", String(hidden))}
          </button>
        )}
      </div>
    </div>
  );
}

/** Nothing linked yet: the session takes shape when the athlete presses Start. */
export function SessionNotBuiltYet() {
  const t = useT();
  return <p className="text-xs text-sage font-semibold">{t("calendar.sessionBuiltOnStart")}</p>;
}
