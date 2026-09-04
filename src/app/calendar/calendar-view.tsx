"use client";

import { useT, useLang } from "@/app/features-provider";
import { fmtDate, fmtNumber, weekdayInitials, type Lang } from "@/lib/i18n";
import type { DictKey } from "@/lib/dict";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "../nav";
import { categoryMeta, EVENT_CATEGORY_META, getWorkoutTypeColor } from "@/lib/categories";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { isCompatibleType, isRunning } from "@/lib/activity-types";
import { isAutoDetectable } from "@/lib/plan-progress";
import { ResolveButtons } from "@/app/resolve-buttons";

// --- Types ---

interface EventOccurrence {
  eventId: string; occurrenceKey: string; date: string; start: string; end: string | null;
  title: string; location: string | null; notes: string | null; category: string;
  allDay: boolean; recurring: boolean; continuation: boolean;
}
interface WorkoutItem {
  workoutId: string; date: string; title: string; workoutType: string; activityType: string;
  targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null;
  description: string | null; status: string;
}
interface ActivityItem {
  activityId: string; date: string; name: string; activityType: string;
  distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null; source: string;
}
type ViewMode = "day" | "week" | "month";
const VIEW_KEY: Record<ViewMode, DictKey> = { day: "calendar.day", week: "calendar.week", month: "calendar.month" };
/** Position in the swipe track: -1 = the page before the anchor, +1 = after it. */
type PageOffset = -1 | 0 | 1;

/** One step of a structured session, as normalised by /api/workouts/[id]/detail. */
interface DetailStep {
  kind: string; label: string | null; distanceKm: number | null; durationMin: number | null;
  pace: string | null; times: number | null; steps: DetailStep[] | null;
}
interface WorkoutDetail {
  workout: {
    id: string; date: string; title: string; workoutType: string; activityType: string;
    targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null;
    description: string | null; steps: DetailStep[]; status: string;
  };
  adjustment: { reason: string; summary: string; action: string; createdAt: string } | null;
  comparable: {
    activityId: string; date: string; name: string; activityType: string;
    distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null;
    avgHeartRate: number | null; sameSessionType: boolean;
  } | null;
}

// --- Planned ↔ done reconciliation (same rule as the plan tab) ---

// "unconfirmed": past, nothing matched, and no way there could have been —
// asked about instead of being called missed.
type WorkoutState = "done" | "missed" | "unconfirmed" | "today" | "future";

interface ReconciledDay {
  rows: { workout: WorkoutItem; matched: ActivityItem | null; state: WorkoutState }[];
  extras: ActivityItem[];
}

const EMPTY_DAY = { events: [] as EventOccurrence[], workouts: [] as WorkoutItem[], activities: [] as ActivityItem[] };

function reconcileDay(workouts: WorkoutItem[], activities: ActivityItem[], today: string, stravaConnected = true): ReconciledDay {
  const used = new Set<string>();
  const rows = workouts.map((w) => {
    const matched =
      activities.find((a) => !used.has(a.activityId) && isCompatibleType(w.activityType, a.activityType)) || null;
    if (matched) used.add(matched.activityId);
    const done = !!matched || w.status === "completed";
    const state: WorkoutState = done
      ? "done"
      : w.date < today
        ? isAutoDetectable(w.activityType, stravaConnected) ? "missed" : "unconfirmed"
        : w.date === today ? "today" : "future";
    return { workout: w, matched, state };
  });
  return { rows, extras: activities.filter((a) => !used.has(a.activityId)) };
}

/**
 * The planned targets, mirroring activityDetail's shape on the "actual" side.
 * Duration-only sessions — rides, S&C — used to fall through to the bare
 * "training plan" label, hiding the one number that defines them.
 */
export function plannedDetail(w: WorkoutItem, t: T): string {
  return (
    [
      w.targetDistanceKm ? `${w.targetDistanceKm} km` : null,
      w.targetPace,
      w.targetDurationMin ? `${Math.round(w.targetDurationMin)} ${t("common.min")}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("calendar.trainingPlan")
  );
}

/** The prescription in one line: how far, how long, how fast. */
function targetLine(w: WorkoutItem, t: T): string {
  const amount = [
    w.targetDistanceKm ? `${w.targetDistanceKm} km` : null,
    w.targetDurationMin ? `${Math.round(w.targetDurationMin)} ${t("common.min")}` : null,
  ].filter(Boolean).join(" · ");
  if (amount && w.targetPace) return `${amount} @ ${w.targetPace}`;
  return amount || w.targetPace || t("calendar.noTarget");
}

/** `useT()`'s return type — the helpers below take it rather than calling hooks. */
type T = (key: DictKey) => string;

const WORKOUT_TYPE_KEY: Record<string, DictKey> = {
  easy: "calendar.workoutType.easy", long: "calendar.workoutType.long", tempo: "calendar.workoutType.tempo",
  interval: "calendar.workoutType.interval", race_pace: "calendar.workoutType.race_pace",
  recovery: "calendar.workoutType.recovery", rest: "calendar.workoutType.rest",
  cross_training: "calendar.workoutType.cross_training", strength: "calendar.workoutType.strength",
  race: "calendar.workoutType.race", climbing: "calendar.workoutType.climbing",
};

/** "easy run", "Tempolauf", … — falls back to the raw type for anything unmapped. */
function workoutTypeLabel(type: string, t: T): string {
  const key = WORKOUT_TYPE_KEY[type];
  return key ? t(key) : type.replace("_", " ");
}

/** Category chips in the event editor, translated at render time. */
const CATEGORY_KEY: Record<string, DictKey> = {
  work: "event.category.work", family: "event.category.family", training: "event.category.training",
  social: "event.category.social", health: "event.category.health", birthday: "event.category.birthday",
  other: "event.category.other",
};

function activityDetail(a: ActivityItem, lang: Lang, t: T): string {
  if (a.distanceKm) {
    return `${fmtNumber(a.distanceKm, lang, 1)} km${a.avgPacePerKm ? ` · ${a.avgPacePerKm.replace("/km", "")}` : ""}`;
  }
  if (a.durationMin) return `${Math.round(a.durationMin)} ${t("common.min")}`;
  return "";
}

// --- Local date helpers (all on yyyy-MM-dd strings, week starts Monday) ---

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toDate(s: string): Date { return new Date(`${s}T00:00:00`); }
function toStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDaysStr(s: string, n: number): string {
  const d = toDate(s); d.setDate(d.getDate() + n); return toStr(d);
}
function startOfWeekStr(s: string): string {
  const d = toDate(s);
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return toStr(d);
}
function startOfMonthStr(s: string): string { return s.slice(0, 8) + "01"; }
function addMonthsStr(s: string, n: number): string {
  const d = toDate(startOfMonthStr(s)); d.setMonth(d.getMonth() + n); return toStr(d);
}
function fmt(s: string, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  return fmtDate(toDate(s), lang, opts);
}

/** The dates one page of a view covers (the month grid spans whole weeks). */
function rangeFor(view: ViewMode, anchor: string): [string, string] {
  if (view === "day") return [anchor, anchor];
  if (view === "week") {
    const ws = startOfWeekStr(anchor);
    return [ws, addDaysStr(ws, 6)];
  }
  const gridStart = startOfWeekStr(startOfMonthStr(anchor));
  const lastDay = addDaysStr(addMonthsStr(anchor, 1), -1);
  return [gridStart, addDaysStr(startOfWeekStr(lastDay), 6)];
}

/** The anchor one page earlier (-1) or later (+1), in this view's unit. */
function shiftAnchor(view: ViewMode, anchor: string, offset: PageOffset): string {
  if (offset === 0) return anchor;
  if (view === "day") return addDaysStr(anchor, offset);
  if (view === "week") return addDaysStr(anchor, offset * 7);
  return addMonthsStr(anchor, offset);
}

// --- Swipe pager (same animation pattern as the plan page) ---

/**
 * A three-page track: the page you are swiping towards is mounted and moving
 * with your finger the whole time. Mounting only the anchor made a swipe read
 * as two — an empty screen slid in, the anchor changed, and the real page slid
 * in after it, so a single gesture looked like skipping a week.
 *
 * The neighbours are absolutely positioned rather than laid out in a flex
 * track: this page scrolls with the document, and a flex row would stretch the
 * viewport to the tallest of the three days (a bare day next to a full session
 * detail would grow a screenful of blank space). Only the anchor page sits in
 * flow, so the page is exactly as tall as what you are looking at.
 */
function SwipePager({
  pageKey,
  renderPage,
  onSwipe,
  className,
}: {
  pageKey: (offset: PageOffset) => string;
  renderPage: (offset: PageOffset) => React.ReactNode;
  onSwipe: (delta: -1 | 1) => void; // -1 = previous, +1 = next
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchDeltaX = useRef(0);
  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const animatingRef = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);
  // The neighbour being committed to, or null at rest.
  const [target, setTarget] = useState<-1 | 1 | null>(null);
  // One frame after the anchor swap, transitions are off so re-centring the
  // track on the new anchor is invisible.
  const [settling, setSettling] = useState(false);

  const slide = useCallback((delta: -1 | 1) => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setSwiping(false);
    setDragOffset(0);
    setTarget(delta);
    setTimeout(() => {
      // Swap the anchor and re-centre the track in one commit, transitions
      // suppressed — the page on screen is the same either side of this.
      setSettling(true);
      onSwipe(delta);
      setTarget(null);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSettling(false);
          animatingRef.current = false;
        });
      });
    }, 240);
  }, [onSwipe]);

  function onTouchStart(e: React.TouchEvent) {
    if (animatingRef.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    touchDeltaX.current = 0;
    directionLocked.current = null;
    setSwiping(true);
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
    touchDeltaX.current = dx;
    setDragOffset(dx);
  }
  function onTouchEnd() {
    if (animatingRef.current || directionLocked.current === "vertical") {
      setSwiping(false); directionLocked.current = null; setDragOffset(0); return;
    }
    const width = containerRef.current?.offsetWidth || 400;
    const threshold = width * 0.25;
    if (touchDeltaX.current < -threshold) slide(1);
    else if (touchDeltaX.current > threshold) slide(-1);
    else { setSwiping(false); setDragOffset(0); }
    directionLocked.current = null;
  }

  // Percent while committing (the neighbour is exactly one viewport away),
  // pixels while the finger is down.
  const transform = target !== null ? `translateX(${-target * 100}%)` : `translateX(${dragOffset}px)`;
  const useTransition = !swiping && !settling;

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden relative ${className || ""}`}
      style={{ touchAction: "pan-y" }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="will-change-transform relative"
        style={{ transform, transition: useTransition ? "transform 0.24s ease-out" : "none" }}
      >
        {/* inert, not aria-hidden: the off-screen pages are full of links, and
            they must not take focus or be read out while parked. */}
        <div key={pageKey(-1)} inert className="absolute top-0 right-full w-full">
          {renderPage(-1)}
        </div>
        <div key={pageKey(0)}>{renderPage(0)}</div>
        <div key={pageKey(1)} inert className="absolute top-0 left-full w-full">
          {renderPage(1)}
        </div>
      </div>
    </div>
  );
}

// --- Event rows ---

function EventChip({ event, onTap }: { event: EventOccurrence; onTap: () => void }) {
  const t = useT();
  const meta = categoryMeta(event.category);
  const isLastDay = event.end?.slice(0, 10) === event.date;
  return (
    <button onClick={onTap} className={`w-full flex items-center gap-2.5 border-2 rounded-xl px-2.5 py-1.5 text-left shadow-[2px_2px_0_var(--color-shade)] sticker-press ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-1.5 self-stretch rounded-full flex-shrink-0 border border-ink/60" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-ink truncate">
          {event.continuation ? "⟶ " : event.category === "birthday" ? "🎂 " : ""}{event.title}
          {event.recurring && <span className="text-sage ml-1">↻</span>}
        </p>
        <p className="text-[10px] text-moss font-semibold truncate tabular-nums">
          {event.continuation
            ? isLastDay && !event.allDay
              ? `${t("calendar.until")} ${event.end!.slice(11, 16)}`
              : t("calendar.continues")
            : event.allDay
            ? t("calendar.allDay")
            : `${event.start.slice(11, 16)}${event.end ? `–${event.end.slice(11, 16)}` : ""}`}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>
    </button>
  );
}

/**
 * Planned | actual, side by side: the plan in the left cell, the matched
 * activity's real numbers in the right one — instead of a tiny badge.
 */
function WorkoutChip({ workout, matched, state }: { workout: WorkoutItem; matched: ActivityItem | null; state: WorkoutState }) {
  const t = useT();
  const lang = useLang();
  return (
    <Link href={matched ? `/activity/${matched.activityId}` : `/calendar?view=day&date=${workout.date}`} className={`sticker sticker-press grid grid-cols-2 overflow-hidden ${state === "today" ? "shadow-[3px_3px_0_var(--color-brocco)]" : ""}`}>
      <div className="px-2.5 py-1.5 border-r-2 border-dashed border-shade min-w-0">
        <p className="label-xs">{t("calendar.planned")}</p>
        <p className={`text-xs font-bold truncate flex items-center gap-1.5 ${state === "missed" ? "text-moss" : "text-ink"}`}>
          <span className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          {workout.title}
        </p>
        <p className="text-[10px] text-moss font-semibold truncate tabular-nums">
          {plannedDetail(workout, t)}
        </p>
      </div>
      {state === "done" ? (
        <div className="px-2.5 py-1.5 bg-sprout min-w-0">
          <p className="label-xs text-leaf!">{t("calendar.doneLabel")}</p>
          <p className="text-xs font-extrabold text-ink truncate tabular-nums">{matched ? activityDetail(matched, lang, t) || matched.name : t("calendar.completed")}</p>
          {matched && <p className="text-[10px] text-leaf font-bold truncate">{matched.source === "strava" ? "strava" : t("calendar.logged")}</p>}
        </div>
      ) : state === "missed" ? (
        <div className="px-2.5 py-1.5 bg-clay-soft min-w-0">
          <p className="label-xs text-clay!">{t("calendar.missed")}</p>
          <p className="text-xs font-bold text-clay truncate">{t("calendar.notRun")}</p>
        </div>
      ) : state === "unconfirmed" ? (
        <div className="px-2.5 py-1.5 bg-[#faeed8] min-w-0">
          <p className="label-xs">? {t("confirm.notConfirmed")}</p>
          <p className="text-[10px] text-moss font-semibold truncate">{t("confirm.notConfirmedHint")}</p>
        </div>
      ) : (
        <div className="px-2.5 py-1.5 bg-ghost min-w-0">
          <p className="label-xs">{t("calendar.actual")}</p>
          <p className="text-xs font-bold text-ghost-ink truncate">{state === "today" ? t("calendar.todayPlaceholder") : "—"}</p>
        </div>
      )}
    </Link>
  );
}

/** A completed activity with no planned workout behind it (spontaneous run, extra ride, ad-hoc session). */
function ActivityChip({ activity }: { activity: ActivityItem }) {
  const t = useT();
  const lang = useLang();
  return (
    <Link href={`/activity/${activity.activityId}`} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-2.5 py-1.5 border-r-2 border-dashed border-shade bg-ghost min-w-0">
        <p className="label-xs">{t("calendar.unplanned")}</p>
        <p className="text-xs font-bold text-ghost-ink truncate">{t("calendar.spontaneous")}</p>
      </div>
      <div className="px-2.5 py-1.5 bg-sprout min-w-0">
        <p className="label-xs text-leaf!">{t("calendar.doneLabel")}</p>
        <p className="text-xs font-extrabold text-ink truncate">{activity.name}</p>
        <p className="text-[10px] text-leaf font-bold truncate tabular-nums">
          {[activityDetail(activity, lang, t), activity.source === "strava" ? "strava" : t("calendar.logged")].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

// --- Day view: the full brief for one session ---

const STEP_KIND_KEY: Record<string, DictKey> = {
  warmup: "workout.warmUp", steady: "calendar.step.steady", work: "calendar.step.work",
  recovery: "calendar.step.recovery", cooldown: "workout.coolDown",
};

function stepAmount(s: DetailStep, lang: Lang, t: T): string {
  const amount =
    s.distanceKm != null
      ? s.distanceKm >= 1 ? `${fmtNumber(s.distanceKm, lang, 2, 0)} km` : `${Math.round(s.distanceKm * 1000)} m`
      : s.durationMin != null ? `${Math.round(s.durationMin)} ${t("common.min")}`
      : "";
  return [amount, s.pace].filter(Boolean).join(" @ ") || "—";
}

function StepRow({ step, nested }: { step: DetailStep; nested?: boolean }) {
  const t = useT();
  const lang = useLang();
  const kindKey = STEP_KIND_KEY[step.kind];
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span className={`text-xs font-bold flex-shrink-0 ${nested ? "text-moss" : "text-ink"}`}>
        {step.label || (kindKey ? t(kindKey) : step.kind)}
      </span>
      <span className="flex-1 border-b border-dotted border-shade" />
      <span className="text-xs font-semibold text-moss tabular-nums text-right">{stepAmount(step, lang, t)}</span>
    </div>
  );
}

/** Warm-up / N × (work, recovery) / cool-down, as the watch will guide it. */
function StepList({ steps }: { steps: DetailStep[] }) {
  const t = useT();
  return (
    <div>
      <p className="label-xs">{t("calendar.theSession")}</p>
      <div className="mt-1 border-2 border-shade rounded-xl px-2.5 py-1 bg-paper">
        {steps.map((s, i) =>
          s.kind === "repeat" && s.steps?.length ? (
            <div key={i} className="py-1">
              <p className="text-xs font-extrabold text-ink tabular-nums">{s.times || 2} ×</p>
              <div className="pl-3 border-l-2 border-shade ml-1">
                {s.steps.map((inner, j) => <StepRow key={j} step={inner} nested />)}
              </div>
            </div>
          ) : (
            <StepRow key={i} step={s} />
          )
        )}
      </div>
    </div>
  );
}

/** "2 Aug · 10 km · 5:34/km · HR 148" */
function comparableLine(c: NonNullable<WorkoutDetail["comparable"]>, lang: Lang, t: T): string {
  return [
    fmt(c.date, lang, { day: "numeric", month: "short" }),
    c.distanceKm ? `${fmtNumber(c.distanceKm, lang, 1)} km` : null,
    c.durationMin && !c.distanceKm ? `${Math.round(c.durationMin)} ${t("common.min")}` : null,
    c.avgPacePerKm,
    c.avgHeartRate ? `${t("calendar.hr")} ${c.avgHeartRate}` : null,
  ].filter(Boolean).join(" · ");
}

/**
 * The day view's reason to exist: the target, the structure, why the coach
 * prescribed it, and the last comparable session to judge it against — none of
 * which fits in the week view's one-line row.
 */
function WorkoutDetailCard({
  workout,
  matched,
  state,
  detail,
  stravaConnected = true,
}: {
  stravaConnected?: boolean;
  workout: WorkoutItem;
  matched: ActivityItem | null;
  state: WorkoutState;
  detail: WorkoutDetail | null | undefined; // undefined = still loading, null = failed
}) {
  const t = useT();
  const lang = useLang();
  // The range endpoint already carries the description, so the "why" is on
  // screen before the detail request lands.
  const description = detail?.workout.description ?? workout.description;
  const adjustment = detail?.adjustment;
  const comparable = detail?.comparable;
  const steps = detail?.workout.steps || [];

  return (
    <article className="sticker-lg overflow-hidden">
      <div className="px-3 py-2.5 border-b-2 border-shade flex items-start gap-2">
        <span
          className="w-3 h-3 rounded-full border-2 border-ink/60 flex-shrink-0 mt-1"
          style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }}
        />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-extrabold text-ink leading-tight">{workout.title}</h2>
          <p className="label-xs mt-0.5">
            {fmt(workout.date, lang, { weekday: "short", day: "numeric", month: "short" })} ·{" "}
            {workoutTypeLabel(workout.workoutType, t)}
          </p>
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        <div>
          <p className="label-xs">{t("calendar.target")}</p>
          <p className="text-sm font-extrabold text-ink tabular-nums">{targetLine(workout, t)}</p>
        </div>

        {steps.length > 0 && <StepList steps={steps} />}

        {(description || adjustment) && (
          <div>
            <p className="label-xs">{t("calendar.whyThisSession")}</p>
            {description && (
              <p className="text-sm text-ink leading-snug whitespace-pre-wrap">{description}</p>
            )}
            {adjustment && (
              <div className="mt-1.5 border-2 border-ink rounded-xl bg-sun/25 px-2.5 py-1.5">
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-ink">
                  {t("calendar.changed").replace("{date}", fmtDate(adjustment.createdAt, lang, { day: "numeric", month: "short" }))}
                </p>
                <p className="text-xs text-ink font-semibold leading-snug">{adjustment.reason}</p>
              </div>
            )}
          </div>
        )}

        {detail === undefined ? (
          <p className="text-xs text-sage font-semibold">{t("calendar.loadingDetail")}</p>
        ) : detail === null ? (
          <p className="text-xs text-clay font-semibold">{t("calendar.detailFailed")}</p>
        ) : comparable ? (
          <div>
            <p className="label-xs">
              {t("calendar.lastOf").replace(
                "{type}",
                comparable.sameSessionType && WORKOUT_TYPE_KEY[workout.workoutType]
                  ? workoutTypeLabel(workout.workoutType, t)
                  : t("calendar.similarSession"),
              )}
            </p>
            <Link href={`/activity/${comparable.activityId}`} className="mt-1 block sticker sticker-press px-2.5 py-1.5">
              <p className="text-sm font-bold text-ink tabular-nums">{comparableLine(comparable, lang, t)}</p>
              <p className="text-[10px] text-moss font-semibold truncate">{comparable.name}</p>
            </Link>
          </div>
        ) : (
          <div>
            <p className="label-xs">{t("calendar.lastSimilar")}</p>
            <p className="text-xs text-sage font-semibold">{t("calendar.nothingComparable")}</p>
          </div>
        )}
      </div>

      {state === "done" ? (
        matched ? (
          <Link href={`/activity/${matched.activityId}`} className="block bg-sprout border-t-2 border-ink px-3 py-2 sticker-press">
            <p className="label-xs text-leaf!">{t("calendar.doneLabel")}</p>
            <p className="text-sm font-extrabold text-ink tabular-nums">{activityDetail(matched, lang, t) || matched.name}</p>
            <p className="text-[10px] text-leaf font-bold">
              {matched.source === "strava" ? "strava" : t("calendar.logged")} · {t("calendar.tapForActivity")}
            </p>
          </Link>
        ) : (
          <div className="bg-sprout border-t-2 border-ink px-3 py-2">
            <p className="label-xs text-leaf!">{t("calendar.doneLabel")}</p>
            <p className="text-sm font-extrabold text-ink">{t("calendar.markedComplete")}</p>
          </div>
        )
      ) : state === "missed" ? (
        <div className="bg-clay-soft border-t-2 border-ink px-3 py-2">
          <p className="label-xs text-clay!">{t("calendar.missed")}</p>
          <p className="text-xs font-bold text-clay">{t("calendar.nothingMatching")}</p>
        </div>
      ) : state === "unconfirmed" || (state === "today" && !isAutoDetectable(workout.activityType, stravaConnected)) ? (
        // The app can't see this sport happen — ask, don't accuse.
        <div className="bg-[#faeed8] border-t-2 border-ink px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="label-xs">{t("confirm.didItHappen")}</p>
            <p className="text-[10px] text-moss font-semibold">{t("confirm.notConfirmedHint")}</p>
          </div>
          <ResolveButtons workoutId={workout.workoutId} compact />
        </div>
      ) : (
        <Link href={`/calendar?view=day&date=${workout.date}`} className="block bg-ghost border-t-2 border-ink px-3 py-2 sticker-press">
          <p className="text-xs font-bold text-moss">
            {state === "today" ? t("calendar.notLoggedOpenPlan") : t("calendar.openInPlan")}
          </p>
        </Link>
      )}
    </article>
  );
}

function DayView({
  date,
  data,
  today,
  details,
  onEventTap,
  stravaConnected = true,
}: {
  date: string;
  stravaConnected?: boolean;
  data: { events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityItem[] };
  today: string;
  details: Record<string, WorkoutDetail | null>;
  onEventTap: (e: EventOccurrence) => void;
}) {
  const t = useT();
  const { rows, extras } = reconcileDay(data.workouts, data.activities, today, stravaConnected);
  return (
    <div className="space-y-3 pb-2">
      {data.events.length > 0 && (
        <div className="space-y-1.5">
          {data.events.map((e) => <EventChip key={e.occurrenceKey} event={e} onTap={() => onEventTap(e)} />)}
        </div>
      )}

      {rows.map(({ workout, matched, state }) => (
        <WorkoutDetailCard
          stravaConnected={stravaConnected}
          key={workout.workoutId}
          workout={workout}
          matched={matched}
          state={state}
          detail={details[workout.workoutId]}
        />
      ))}

      {rows.length === 0 && (
        <p className="text-xs text-sage font-semibold py-1">
          {date < today ? t("calendar.nothingWasPlanned") : t("calendar.nothingPlanned")}
        </p>
      )}

      {extras.length > 0 && (
        <div className="space-y-1.5">
          <p className="label-xs">{rows.length > 0 ? t("calendar.alsoDone") : t("calendar.doneAnyway")}</p>
          {extras.map((a) => <ActivityChip key={a.activityId} activity={a} />)}
        </div>
      )}
    </div>
  );
}

// --- Event form (create + edit) ---

interface EventFormData {
  id?: string;
  title: string; date: string; time: string; endDate: string; endTime: string; allDay: boolean;
  category: string; location: string; notes: string;
  recurrence: string; recurrenceInterval: number; recurrenceUntil: string;
  reminderMinutes: string;
}

function emptyForm(date: string): EventFormData {
  return {
    title: "", date, time: "", endDate: "", endTime: "", allDay: false, category: "other",
    location: "", notes: "", recurrence: "none", recurrenceInterval: 1, recurrenceUntil: "", reminderMinutes: "",
  };
}

function EventFormModal({
  form: initial,
  onClose,
  onSaved,
}: {
  form: EventFormData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<EventFormData>) => setForm((f) => ({ ...f, ...patch }));

  async function handleSave() {
    if (!form.title.trim() || !form.date) return;
    setSaving(true);
    const allDay = form.allDay || !form.time;
    // Multi-day support: an end date different from the start date makes the
    // event span days (trip, overnight travel). All-day multi-day events get
    // an end of endDate 23:59 so the expansion covers the whole last day.
    const endDate = form.endDate && form.endDate > form.date ? form.endDate : form.date;
    let end: string | null = null;
    if (allDay) {
      end = endDate !== form.date ? `${endDate}T23:59` : null;
    } else if (form.endTime || endDate !== form.date) {
      end = `${endDate}T${form.endTime || form.time}`;
    }
    const payload = {
      title: form.title.trim(),
      start: allDay ? form.date : `${form.date}T${form.time}`,
      end,
      allDay,
      category: form.category,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
      recurrence: form.recurrence,
      recurrenceInterval: form.recurrenceInterval,
      recurrenceUntil: form.recurrenceUntil || null,
      reminderMinutes: form.reminderMinutes ? Number(form.reminderMinutes) : null,
    };
    const res = form.id
      ? await fetch(`/api/events/${form.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      : await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
  }

  const inputCls = "field";

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] p-4 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-extrabold text-ink">{form.id ? t("event.edit") : t("calendar.newEvent")}</h2>
          <button onClick={onClose} aria-label={t("common.close")} className="text-moss hover:text-ink text-xl leading-none">&times;</button>
        </div>

        <div className="space-y-2.5">
          <input autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("event.title")} className={inputCls} />

          <div className="flex gap-2">
            <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={inputCls} />
            <label className="flex items-center gap-1.5 text-xs text-ink font-bold flex-shrink-0 px-1">
              <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="accent-[#9ccb2e]" />
              {t("event.allDay")}
            </label>
          </div>

          {!form.allDay && (
            <div className="flex gap-2 items-center">
              <input type="time" value={form.time} onChange={(e) => set({ time: e.target.value })} className={inputCls} />
              <span className="text-moss text-xs font-bold">{t("event.to")}</span>
              <input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={inputCls} />
            </div>
          )}

          <div className="flex gap-2 items-center">
            <span className="text-xs text-moss font-bold flex-shrink-0 w-14">{t("event.endsOn")}</span>
            <input
              type="date"
              value={form.endDate}
              min={form.date}
              onChange={(e) => set({ endDate: e.target.value })}
              className={inputCls}
              title={t("event.endsOnHint")}
            />
            {form.endDate && form.endDate !== form.date && (
              <button onClick={() => set({ endDate: "" })} className="text-xs text-moss font-bold hover:text-ink flex-shrink-0">{t("event.clear")}</button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(EVENT_CATEGORY_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => set({ category: key })}
                className={`px-2.5 py-1 rounded-full text-xs border-2 transition-colors font-bold ${
                  form.category === key ? "border-ink text-ink" : "border-shade text-moss hover:border-ink"
                }`}
                style={form.category === key ? { backgroundColor: meta.color } : {}}
              >
                {CATEGORY_KEY[key] ? t(CATEGORY_KEY[key]) : meta.label}
              </button>
            ))}
          </div>

          <input value={form.location} onChange={(e) => set({ location: e.target.value })} placeholder={t("event.location")} className={inputCls} />
          <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t("event.notes")} rows={2} className={inputCls} />

          <div className="flex gap-2 items-center">
            <select value={form.recurrence} onChange={(e) => set({ recurrence: e.target.value })} className={inputCls}>
              <option value="none">{t("event.noRepeat")}</option>
              <option value="daily">{t("event.daily")}</option>
              <option value="weekly">{t("event.weekly")}</option>
              <option value="monthly">{t("event.monthly")}</option>
              <option value="yearly">{t("event.yearly")}</option>
            </select>
            {form.recurrence !== "none" && (
              <input
                type="date" value={form.recurrenceUntil} onChange={(e) => set({ recurrenceUntil: e.target.value })}
                className={inputCls} title={t("event.repeatUntil")}
              />
            )}
          </div>

          <select value={form.reminderMinutes} onChange={(e) => set({ reminderMinutes: e.target.value })} className={inputCls}>
            <option value="">{t("event.noReminder")}</option>
            <option value="0">{t("event.atStart")}</option>
            <option value="15">{t("event.min15Before")}</option>
            <option value="60">{t("event.hourBefore")}</option>
            <option value="1440">{t("event.dayBefore")}</option>
          </select>

          <button
            onClick={handleSave}
            disabled={saving || !form.title.trim()}
            className="btn-brocco w-full py-2.5 text-sm"
          >
            {saving ? t("common.saving") : form.id ? t("event.saveChanges") : t("event.add")}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Event detail sheet ---

function EventDetailSheet({
  occurrence,
  onClose,
  onEdit,
  onChanged,
}: {
  occurrence: EventOccurrence;
  onClose: () => void;
  onEdit: (form: EventFormData) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const meta = categoryMeta(occurrence.category);

  async function loadForEdit() {
    setBusy(true);
    const res = await fetch(`/api/events/${occurrence.eventId}`);
    setBusy(false);
    if (!res.ok) return;
    const { event } = await res.json();
    onEdit({
      id: event.id,
      title: event.title,
      date: event.start.slice(0, 10),
      time: event.allDay ? "" : event.start.slice(11, 16),
      endDate: event.end && event.end.slice(0, 10) !== event.start.slice(0, 10) ? event.end.slice(0, 10) : "",
      endTime: event.end ? event.end.slice(11, 16) : "",
      allDay: event.allDay,
      category: event.category,
      location: event.location || "",
      notes: event.notes || "",
      recurrence: event.recurrence,
      recurrenceInterval: event.recurrenceInterval || 1,
      recurrenceUntil: event.recurrenceUntil || "",
      reminderMinutes: event.reminderMinutes != null ? String(event.reminderMinutes) : "",
    });
    onClose();
  }

  async function handleDelete(scope: "occurrence" | "series") {
    setBusy(true);
    const url = scope === "occurrence"
      ? `/api/events/${occurrence.eventId}?scope=occurrence&date=${occurrence.date}`
      : `/api/events/${occurrence.eventId}`;
    const res = await fetch(url, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { onChanged(); onClose(); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full md:max-w-md bg-paper border-2 border-ink rounded-t-2xl md:rounded-2xl md:shadow-[4px_4px_0_var(--color-shade)] p-4 safe-bottom">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-1.5 self-stretch rounded-full border border-ink/60" style={{ backgroundColor: meta.color }} />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-ink">{occurrence.category === "birthday" ? "🎂 " : ""}{occurrence.title}</h2>
            <p className="text-xs text-moss font-semibold mt-0.5">
              {fmt(occurrence.date, lang, { weekday: "long", day: "numeric", month: "long" })}
              {!occurrence.allDay && ` · ${occurrence.start.slice(11, 16)}${occurrence.end ? `–${occurrence.end.slice(11, 16)}` : ""}`}
              {occurrence.recurring && ` · ${t("calendar.repeats")}`}
            </p>
            {occurrence.location && <p className="text-xs text-moss font-semibold mt-1">📍 {occurrence.location}</p>}
            {occurrence.notes && <p className="text-xs text-ink mt-2 whitespace-pre-wrap">{occurrence.notes}</p>}
          </div>
          <button onClick={onClose} aria-label={t("common.close")} className="text-moss hover:text-ink text-xl leading-none">&times;</button>
        </div>
        <div className="flex gap-2">
          <button onClick={loadForEdit} disabled={busy} className="btn-quiet flex-1 py-2 text-sm disabled:opacity-50">{t("common.edit")}</button>
          {occurrence.recurring ? (
            <>
              <button onClick={() => handleDelete("occurrence")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">{t("calendar.deleteThis")}</button>
              <button onClick={() => handleDelete("series")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">{t("calendar.deleteAll")}</button>
            </>
          ) : (
            <button onClick={() => handleDelete("series")} disabled={busy} className="btn-danger flex-1 py-2 text-sm disabled:opacity-50">{t("common.delete")}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main calendar ---

export default function CalendarView() {
  // Deep link: /calendar?date=yyyy-MM-dd&view=day. Tapping a session anywhere
  // in the app lands here, because this is where session detail now lives —
  // the plan tab deliberately no longer renders individual workouts.
  const params = useSearchParams();
  const linkedDate = params.get("date");
  const linkedView = params.get("view");
  const [view, setView] = useState<ViewMode>(
    linkedView === "day" || linkedView === "week" || linkedView === "month" ? linkedView : "week"
  );
  const [anchor, setAnchor] = useState(
    linkedDate && /^\d{4}-\d{2}-\d{2}$/.test(linkedDate) ? linkedDate : todayStr()
  );
  const [events, setEvents] = useState<EventOccurrence[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutItem[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [stravaConnected, setStravaConnected] = useState(true);
  const [formOpen, setFormOpen] = useState<EventFormData | null>(null);
  const [detail, setDetail] = useState<EventOccurrence | null>(null);
  // Per-workout depth for the day view. null = the request failed, so the card
  // says so instead of waiting forever.
  const [details, setDetails] = useState<Record<string, WorkoutDetail | null>>({});
  const detailsRequested = useRef<Set<string>>(new Set());
  const today = todayStr();
  const t = useT();
  const lang = useLang();

  // Visible range per view
  const [rangeStart, rangeEnd] = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  // The pager's neighbours are real pages you can already see mid-swipe, so
  // their data has to be here before the finger arrives.
  const [fetchStart, fetchEnd] = useMemo(
    () => [rangeFor(view, shiftAnchor(view, anchor, -1))[0], rangeFor(view, shiftAnchor(view, anchor, 1))[1]],
    [view, anchor]
  );

  const fetchData = useCallback(() => {
    fetch(`/api/events?from=${fetchStart}&to=${fetchEnd}`)
      .then((r) => r.json())
      .then((d) => { setEvents(d.events || []); setWorkouts(d.workouts || []); setActivities(d.activities || []); setStravaConnected(d.stravaConnected !== false); })
      .catch(() => {});
  }, [fetchStart, fetchEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // A plan change rewrites targets and reasons, so the cached depth goes too.
  const refresh = useCallback(() => {
    detailsRequested.current.clear();
    setDetails({});
    fetchData();
  }, [fetchData]);
  useDataChanged(["calendar", "plan", "activities"], refresh);

  // Only the day view shows this much; pulling it for a month of workouts
  // would be dozens of requests nobody looks at.
  useEffect(() => {
    if (view !== "day") return;
    for (const w of workouts) {
      // Arriving from the month view, `workouts` still holds the whole month
      // until the day's fetch lands — the three days on the track are all that
      // can be read.
      if (w.date < fetchStart || w.date > fetchEnd) continue;
      if (detailsRequested.current.has(w.workoutId)) continue;
      detailsRequested.current.add(w.workoutId);
      fetch(`/api/workouts/${w.workoutId}/detail`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: WorkoutDetail | null) => setDetails((prev) => ({ ...prev, [w.workoutId]: d })))
        .catch(() => setDetails((prev) => ({ ...prev, [w.workoutId]: null })));
    }
  }, [view, workouts, fetchStart, fetchEnd]);

  useScreenContext(
    {
      name: "calendar",
      view,
      rangeStart,
      rangeEnd,
      selectedItem: detail ? { type: "event", id: detail.eventId, title: detail.title, date: detail.date } : undefined,
    },
    [view, rangeStart, rangeEnd, detail?.eventId]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, { events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityItem[] }>();
    const get = (d: string) => {
      if (!map.has(d)) map.set(d, { events: [], workouts: [], activities: [] });
      return map.get(d)!;
    };
    for (const e of events) get(e.date).events.push(e);
    for (const w of workouts) get(w.date).workouts.push(w);
    for (const a of activities) get(a.date).activities.push(a);
    for (const v of map.values()) {
      v.events.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
    }
    return map;
  }, [events, workouts, activities]);

  const navigate = useCallback((delta: -1 | 1) => {
    setAnchor((a) => shiftAnchor(view, a, delta));
  }, [view]);

  const headerLabel = useMemo(() => {
    if (view === "day") return fmt(anchor, lang, { weekday: "long", day: "numeric", month: "long" });
    if (view === "week") {
      const ws = startOfWeekStr(anchor);
      const we = addDaysStr(ws, 6);
      return `${fmt(ws, lang, { day: "numeric", month: "short" })} – ${fmt(we, lang, { day: "numeric", month: "short" })}`;
    }
    return fmt(startOfMonthStr(anchor), lang, { month: "long", year: "numeric" });
  }, [view, anchor, lang]);

  // --- Day section (used by day + week views) ---
  function DaySection({ date, compact }: { date: string; compact?: boolean }) {
    const data = byDate.get(date) || { events: [], workouts: [], activities: [] };
    const isToday = date === today;
    const isEmpty = data.events.length === 0 && data.workouts.length === 0 && data.activities.length === 0;
    // In the week view (compact) the ENTIRE row — chips included — opens that
    // day's day view: a capture-phase handler claims the tap before the chips'
    // own actions fire (those all remain one tap away inside the day view).
    // Elsewhere chips stay interactive and only the row's dead space opens
    // the day.
    const openDay = () => {
      setAnchor(date);
      setView("day");
    };
    const rowTap = compact
      ? {
          onClickCapture: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            openDay();
          },
        }
      : {
          onClick: (e: React.MouseEvent) => {
            if ((e.target as HTMLElement).closest("a, button")) return;
            openDay();
          },
        };
    if (compact && isEmpty) {
      return (
        <div {...rowTap} className="flex items-center gap-3 py-1.5 opacity-60 cursor-pointer">
          <DayLabel date={date} isToday={isToday} />
          <div className="flex-1 border-b-2 border-dotted border-shade" />
        </div>
      );
    }
    const { rows, extras } = reconcileDay(data.workouts, data.activities, today, stravaConnected);
    return (
      <div {...rowTap} className="flex gap-3 py-1.5 cursor-pointer">
        <DayLabel date={date} isToday={isToday} />
        <div className="flex-1 min-w-0 space-y-1.5">
          {data.events.map((e) => <EventChip key={e.occurrenceKey} event={e} onTap={() => setDetail(e)} />)}
          {rows.map(({ workout, matched, state }) => (
            <WorkoutChip key={workout.workoutId} workout={workout} matched={matched} state={state} />
          ))}
          {extras.map((a) => <ActivityChip key={a.activityId} activity={a} />)}
          {!compact && isEmpty && <p className="text-xs text-sage font-semibold py-2">{t("calendar.nothingScheduled")}</p>}
        </div>
      </div>
    );
  }

  function renderPage(offset: PageOffset) {
    const pageAnchor = shiftAnchor(view, anchor, offset);
    const [start, end] = rangeFor(view, pageAnchor);
    if (view === "month") {
      return (
        <MonthGrid
          rangeStart={start}
          rangeEnd={end}
          anchorMonth={pageAnchor.slice(0, 7)}
          today={today}
          byDate={byDate}
          stravaConnected={stravaConnected}
          onDayTap={(d) => { setAnchor(d); setView("day"); }}
        />
      );
    }
    if (view === "week") {
      const days = Array.from({ length: 7 }, (_, i) => addDaysStr(start, i));
      // Planned vs completed roll-up for the visible week. Running km only —
      // the measure the plan counts volume in (rides and S&C are duration-
      // based and would inflate a km total).
      let plannedKm = 0, runKm = 0, plannedSessions = 0, doneSessions = 0;
      for (const d of days) {
        const data = byDate.get(d) || EMPTY_DAY;
        for (const w of data.workouts) {
          if (w.activityType === "run" && w.targetDistanceKm) plannedKm += w.targetDistanceKm;
        }
        for (const a of data.activities) {
          if (isRunning(a.activityType) && a.distanceKm) runKm += a.distanceKm;
        }
        const { rows } = reconcileDay(data.workouts, data.activities, today, stravaConnected);
        const sessions = rows.filter((r) => r.workout.workoutType !== "rest");
        plannedSessions += sessions.length;
        doneSessions += sessions.filter((r) => r.state === "done").length;
      }
      return (
        <div>
          {(plannedKm > 0 || runKm > 0 || plannedSessions > 0) && (
            <div className="flex items-center justify-between px-1 pb-1.5 text-xs font-bold tabular-nums">
              {plannedKm > 0 || runKm > 0 ? (
                <p className="text-moss">
                  🏃 {fmtNumber(runKm, lang, 1)}
                  {plannedKm > 0 ? <span className="text-sage"> / {plannedKm.toFixed(0)} km</span> : <span> km</span>}
                </p>
              ) : (
                // No running km this week (climbing and other sessions-based
                // plans) — sessions are the headline instead.
                <p className="text-moss">
                  💪 {doneSessions}<span className="text-sage"> / {plannedSessions} {t("common.sessions")}</span>
                </p>
              )}
              {(plannedKm > 0 || runKm > 0) && plannedSessions > 0 && (
                <p className="text-sage">{doneSessions} / {plannedSessions} {t("common.sessions")}</p>
              )}
            </div>
          )}
          <div className="divide-y-2 divide-shade/40">
            {days.map((d) => (
              <DaySection key={d} date={d} compact />
            ))}
          </div>
        </div>
      );
    }
    return (
      <DayView
        stravaConnected={stravaConnected}
        date={pageAnchor}
        data={byDate.get(pageAnchor) || EMPTY_DAY}
        today={today}
        details={details}
        onEventTap={setDetail}
      />
    );
  }

  function DayLabel({ date, isToday }: { date: string; isToday: boolean }) {
    return (
      <button onClick={() => { setAnchor(date); setView("day"); }} className="w-11 flex-shrink-0 text-center pt-0.5">
        <p className={`text-[10px] font-extrabold uppercase ${isToday ? "text-leaf" : "text-sage"}`}>{fmt(date, lang, { weekday: "short" })}</p>
        <p className={`text-lg font-extrabold leading-tight tabular-nums ${isToday ? "text-leaf" : "text-ink"}`}>{toDate(date).getDate()}</p>
      </button>
    );
  }

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12 flex flex-col">
      <PageHeader title={t("calendar.title")} />

      {/* View switcher + nav */}
      <div className="flex items-center justify-between mt-2 mb-1">
        <div className="flex sticker rounded-xl p-0.5">
          {(["day", "week", "month"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs rounded-lg capitalize transition-colors font-bold ${view === v ? "bg-brocco text-ink" : "text-sage hover:text-ink"}`}
            >
              {t(VIEW_KEY[v])}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {anchor !== today && (
            <button onClick={() => setAnchor(today)} className="px-2 py-1 text-xs text-leaf font-bold hover:opacity-70">{t("calendar.today")}</button>
          )}
          <button onClick={() => navigate(-1)} aria-label={t("calendar.previous")} className="p-1.5 text-moss hover:text-ink">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => navigate(1)} aria-label={t("calendar.next")} className="p-1.5 text-moss hover:text-ink">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <p className="text-sm font-extrabold text-ink mb-2">{headerLabel}</p>

      {/* Views */}
      <SwipePager
        className="flex-1"
        pageKey={(o) => `${view}:${shiftAnchor(view, anchor, o)}`}
        renderPage={renderPage}
        onSwipe={navigate}
      />

      {/* Add-event FAB (left of the mic) */}
      <button
        onClick={() => setFormOpen(emptyForm(view === "day" ? anchor : today))}
        aria-label={t("event.add")}
        className="fixed z-[60] w-12 h-12 rounded-full bg-card border-2 border-ink shadow-[3px_3px_0_var(--color-shade)] hover:bg-ghost active:translate-x-[2px] active:translate-y-[2px] active:shadow-none flex items-center justify-center transition-all"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.75rem)", right: "calc(1rem + 4.25rem)" }}
      >
        <span className="text-2xl text-ink leading-none">+</span>
      </button>

      {formOpen && (
        <EventFormModal form={formOpen} onClose={() => setFormOpen(null)} onSaved={refresh} />
      )}
      {detail && (
        <EventDetailSheet
          occurrence={detail}
          onClose={() => setDetail(null)}
          onEdit={(f) => setFormOpen(f)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}

// --- Month grid ---

/**
 * A mark in a month cell. `color` carries what the thing is (session type or
 * event category); `shape` carries how it went, on a separate visual channel so
 * the two can never be confused.
 */
interface MonthMark {
  title: string;
  color: string;
  shape: "planned" | "done" | "missed" | "event";
}

function MonthDot({ mark }: { mark: MonthMark }) {
  const base = "w-2 h-2 md:w-1.5 md:h-1.5 flex-shrink-0 border";
  if (mark.shape === "event") {
    // Square = life event, circle = training. Shape separates the two kinds.
    return <span className={`${base} rounded-[2px] border-ink/50`} style={{ backgroundColor: mark.color }} />;
  }
  if (mark.shape === "planned") {
    // Hollow = not yet done. Any solid circle has already happened one way or
    // the other, so fill alone answers "did this happen?".
    return <span className={`${base} rounded-full bg-transparent`} style={{ borderColor: mark.color, borderWidth: 2 }} />;
  }
  return <span className={`${base} rounded-full border-ink/50`} style={{ backgroundColor: mark.color }} />;
}

function MonthLegend() {
  const t = useT();
  const entries: { mark: MonthMark; label: string }[] = [
    { mark: { title: "", color: "#9ccb2e", shape: "done" }, label: t("calendar.legendDone") },
    { mark: { title: "", color: "#b25b33", shape: "missed" }, label: t("calendar.legendMissed") },
    { mark: { title: "", color: "#4a90d6", shape: "planned" }, label: t("calendar.legendPlanned") },
    { mark: { title: "", color: "#a86fd1", shape: "event" }, label: t("calendar.legendEvent") },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-shade">
      {entries.map((e) => (
        <span key={e.label} className="flex items-center gap-1.5">
          <MonthDot mark={e.mark} />
          <span className="text-[10px] font-semibold text-moss">{e.label}</span>
        </span>
      ))}
    </div>
  );
}


function MonthGrid({
  rangeStart,
  rangeEnd,
  anchorMonth,
  today,
  byDate,
  stravaConnected = true,
  onDayTap,
}: {
  rangeStart: string;
  rangeEnd: string;
  anchorMonth: string; // yyyy-MM
  today: string;
  byDate: Map<string, { events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityItem[] }>;
  stravaConnected?: boolean;
  onDayTap: (date: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const days: string[] = [];
  let d = rangeStart;
  while (d <= rangeEnd) { days.push(d); d = addDaysStr(d, 1); }
  const weeks: string[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {weekdayInitials(lang).map((l, i) => (
          <div key={i} className="text-center text-[10px] font-extrabold text-sage">{l}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((date) => {
            const inMonth = date.slice(0, 7) === anchorMonth;
            const data = byDate.get(date);
            const reconciled = reconcileDay(data?.workouts || [], data?.activities || [], today, stravaConnected);
            // Colour says WHAT it is, shape and fill say HOW IT WENT. Colour
            // alone was ambiguous: an easy run and a completed session are both
            // #9ccb2e, intervals and a missed session are both #d9534c — so a
            // green dot could mean "done" or "easy run" with no way to tell.
            const items: MonthMark[] = [
              ...(data?.events || []).map((e) => ({
                title: `${e.continuation ? "⟶ " : ""}${e.title}`,
                color: categoryMeta(e.category).color,
                shape: "event" as const,
              })),
              ...reconciled.rows.map(({ workout, state }) => ({
                title: `${state === "done" ? "✓ " : state === "missed" ? "✗ " : ""}${workout.title}`,
                color:
                  state === "done" ? "#9ccb2e"
                  : state === "missed" ? "#b25b33"
                  : getWorkoutTypeColor(workout.workoutType),
                shape: (state === "done" ? "done" : state === "missed" ? "missed" : "planned") as MonthMark["shape"],
              })),
              ...reconciled.extras.map((a) => ({ title: `✓ ${a.name}`, color: "#9ccb2e", shape: "done" as const })),
            ];
            const dots = items.slice(0, 4);
            const isToday = date === today;
            return (
              <button
                key={date}
                onClick={() => onDayTap(date)}
                className={`aspect-square md:aspect-[4/5] flex flex-col items-center md:items-stretch justify-start pt-1.5 md:px-1 rounded-xl transition-colors hover:bg-ghost overflow-hidden ${!inMonth ? "opacity-30" : ""}`}
              >
                <span className={`text-sm w-7 h-7 flex items-center justify-center rounded-full md:self-center flex-shrink-0 tabular-nums ${isToday ? "bg-brocco border-2 border-ink text-ink font-extrabold" : "text-ink font-bold"}`}>
                  {toDate(date).getDate()}
                </span>
                {/* Mobile: color dots (cells too small for text) */}
                <div className="flex gap-0.5 mt-0.5 md:hidden justify-center">
                  {dots.map((it, i) => (
                    <MonthDot key={i} mark={it} />
                  ))}
                </div>
                {/* Desktop: truncated titles */}
                <div className="hidden md:block w-full space-y-0.5 mt-0.5">
                  {items.slice(0, 2).map((it, i) => (
                    <div key={i} className="flex items-center gap-1 min-w-0">
                      <MonthDot mark={it} />
                      <span className="text-[10px] text-ink font-semibold truncate text-left">{it.title}</span>
                    </div>
                  ))}
                  {items.length > 2 && (
                    <p className="text-[9px] text-sage font-bold text-left pl-2">{t("calendar.moreItems").replace("{n}", String(items.length - 2))}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ))}
      <MonthLegend />
    </div>
  );
}
