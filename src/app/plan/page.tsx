"use client";

import { useT, useLang } from "@/app/features-provider";
import { fmtDate, type Lang } from "@/lib/i18n";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { isRunning } from "@/lib/activity-types";
import { PageHeader } from "@/app/nav";
import { useWeeklyGoals, WeeklyGoalsTracker } from "@/app/weekly-goals-tracker";

/**
 * Plan = the arc. Where am I in this training block, is the volume going the
 * right way, how long until the race. Individual sessions deliberately live in
 * Calendar — this page never renders a workout.
 */

// --- Types (mirror /api/plan) ---

interface Phase { id: string; name: string; orderIndex: number; description: string | null; startWeek: number; endWeek: number; }
interface Workout { id: string; phaseId: string | null; weekNumber: number; date: string; title: string; workoutType: string; activityType: string; targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null; description: string | null; status: string; }
interface PlanWeekData { id: string; weekNumber: number; startDate: string; detailLevel: string; targetKm: number | null; targetSessions: number | null; sessionTypes: string[] | null; notes: string | null; actualKm: number | null; phaseName: string | null; }
interface WeeklyTask { id: string; weekNumber: number; description: string; category: string; status: string; }
interface DayActivity { id: string; name: string; activityType: string; distanceKm: number | null; durationMin: number | null; avgPacePerKm: string | null; avgHeartRate: number | null; source: string; }
interface Plan { id: string; name: string; goal: string | null; raceDate: string | null; startDate: string; endDate: string; status: string; phases: Phase[]; weeks: PlanWeekData[]; workouts: Workout[]; weeklyTasks: WeeklyTask[]; activitiesByDate: Record<string, DayActivity[]>; }

// --- Dates ---

/** Local-calendar ISO date. Never toISOString() on a local midnight — it slips a day west of UTC. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Computed per call, not cached at module load: this is a PWA people leave open
 * on a phone, so a module-level constant would still claim yesterday's date
 * after midnight.
 */
function today(): string {
  return isoOf(new Date());
}

/** The seven calendar dates of a plan week, keyed the same way as activitiesByDate. */
function weekDates(startDate: string): string[] {
  const start = new Date(`${startDate.split("T")[0]}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return isoOf(d);
  });
}

function formatDay(iso: string, lang: Lang): string {
  return fmtDate(iso.split("T")[0], lang, { month: "short", day: "numeric" });
}

function formatWeekRange(startDate: string, lang: Lang): string {
  const dates = weekDates(startDate);
  return `${formatDay(dates[0], lang)} – ${formatDay(dates[6], lang)}`;
}

function daysUntil(iso: string): number {
  const target = new Date(`${iso.split("T")[0]}T00:00:00`).getTime();
  const todayMs = new Date(`${today()}T00:00:00`).getTime();
  return Math.round((target - todayMs) / 86_400_000);
}

// --- Week maths ---

interface WeekSummary {
  targetKm: number;
  targetSessions: number;
  actualKm: number;
  sessions: number;
}

/**
 * Actuals come from the activity list rather than PlanWeek.actualKm: the stored
 * roll-up is only refreshed on sync, and the current week's number is the
 * headline on this page — it has to be right the moment a run lands.
 */
function summariseWeek(week: PlanWeekData, workouts: Workout[], byDate: Record<string, DayActivity[]>): WeekSummary {
  const dates = weekDates(week.startDate);
  const days = dates.map((d) => byDate[d] || []);
  return {
    targetKm: week.targetKm ?? workouts.reduce((s, w) => s + (w.targetDistanceKm || 0), 0),
    targetSessions: week.targetSessions ?? workouts.filter((w) => w.workoutType !== "rest").length,
    actualKm: days.reduce((sum, acts) => sum + acts.filter((a) => isRunning(a.activityType)).reduce((s, a) => s + (a.distanceKm || 0), 0), 0),
    // Days trained, not activities: a double day is one session's worth of
    // effort against a plan that counts sessions per week.
    sessions: days.filter((acts) => acts.length > 0).length,
  };
}

/** GPS and rounding make an exact hit vanishingly rare; within 5% is a hit. */
function targetHit(s: WeekSummary): boolean {
  if (s.targetKm > 0) return s.actualKm >= s.targetKm * 0.95;
  // Sessions-based week (climbing and other non-distance plans set target_km
  // to 0): hit when every planned session happened.
  return s.targetSessions > 0 && s.sessions >= s.targetSessions;
}

/** A week with no km target but planned sessions is tracked by sessions. */
function isSessionsBased(s: WeekSummary): boolean {
  return s.targetKm === 0 && s.targetSessions > 0;
}

// --- Cards ---

function ArcHeader({
  plan, phase, nextPhase, weekPos, totalWeeks, currentWeekNum,
}: {
  plan: Plan; phase: Phase | undefined; nextPhase: Phase | undefined;
  weekPos: number; totalWeeks: number; currentWeekNum: number | undefined;
}) {
  const t = useT();
  const lang = useLang();
  const phaseLen = phase ? phase.endWeek - phase.startWeek + 1 : 0;
  const phaseWeek = phase && currentWeekNum !== undefined ? currentWeekNum - phase.startWeek + 1 : 0;
  const weeksLeft = phase && currentWeekNum !== undefined ? phase.endWeek - currentWeekNum : 0;
  const raceIn = plan.raceDate ? daysUntil(plan.raceDate) : null;

  return (
    <section className="sticker-lg px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-ink truncate">{phase?.name || plan.goal || plan.name}</h1>
        <span className="text-sm font-bold text-moss tabular-nums flex-shrink-0">
          {weekPos > 0 ? `${t("common.week")} ${weekPos} ${t("plan.weekOf")} ${totalWeeks}` : `${totalWeeks} ${t("plan.weeksTotal")}`}
        </span>
      </div>

      {phase && phaseWeek > 0 && (
        <>
          <div className="h-2.5 bg-ghost border-2 border-ink rounded-full overflow-hidden mt-2.5">
            <div className="h-full bg-brocco transition-all duration-500" style={{ width: `${(phaseWeek / phaseLen) * 100}%` }} />
          </div>
          <p className="text-xs font-bold text-moss mt-1.5">
            {weeksLeft <= 0
              ? `${t("plan.lastWeekOf")} ${phase.name}`
              : `${t("plan.phaseEndsIn")} ${weeksLeft} ${weeksLeft === 1 ? t("unit.week") : t("unit.weeks")}`}
            {nextPhase ? <span className="text-leaf"> → {nextPhase.name}</span> : <span className="text-leaf"> → race</span>}
          </p>
        </>
      )}

      {plan.raceDate && raceIn !== null && (
        <div className="flex items-center gap-3 mt-3 pt-3 border-t-2 border-dashed border-shade">
          <span className="text-lg flex-shrink-0">🏁</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-ink truncate">{plan.goal || t("plan.raceDay")}</p>
            <p className="text-xs text-moss font-semibold tabular-nums">
              {fmtDate(plan.raceDate.split("T")[0], lang, { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            {raceIn > 0 ? (
              <>
                <p className="text-xl font-extrabold text-ink leading-none tabular-nums">{raceIn}</p>
                <p className="label-xs">{raceIn === 1 ? t("plan.day") : t("plan.days")}</p>
              </>
            ) : (
              <p className="text-sm font-extrabold text-leaf">{raceIn === 0 ? `${t("common.today")}!` : t("common.done")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ThisWeekCard({
  week, summary, lastWeek, lastSummary, goals, tasks, onToggleTask,
}: {
  week: PlanWeekData | undefined; summary: WeekSummary | null;
  lastWeek: PlanWeekData | undefined; lastSummary: WeekSummary | null;
  goals: ReturnType<typeof useWeeklyGoals>;
  tasks: WeeklyTask[]; onToggleTask: (id: string, status: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const sessionsBased = !!summary && isSessionsBased(summary);
  const pct = !summary
    ? 0
    : sessionsBased
    ? Math.min((summary.sessions / summary.targetSessions) * 100, 100)
    : summary.targetKm > 0
    ? Math.min((summary.actualKm / summary.targetKm) * 100, 100)
    : 0;

  return (
    <section className="sticker px-4 py-3">
      {week && summary && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="label-xs">{t("plan.thisWeek")}</p>
            <p className="text-xs text-sage font-bold">{formatWeekRange(week.startDate, lang)}</p>
          </div>
          <div className="flex items-baseline justify-between gap-2 mt-0.5">
            {sessionsBased ? (
              <p className="text-ink tabular-nums">
                <span className="text-2xl font-extrabold">{summary.sessions}</span>
                <span className="text-sage font-bold"> / {summary.targetSessions} {t("common.sessions")}</span>
              </p>
            ) : (
              <>
                <p className="text-ink tabular-nums">
                  <span className="text-2xl font-extrabold">{summary.actualKm.toFixed(0)}</span>
                  {summary.targetKm > 0 && <span className="text-sage font-bold"> / {summary.targetKm.toFixed(0)} {t("common.km")}</span>}
                </p>
                {summary.targetSessions > 0 && (
                  <p className="text-xs font-bold text-moss tabular-nums">{summary.sessions} {t("plan.weekOf")} {summary.targetSessions} {t("common.sessions")}</p>
                )}
              </>
            )}
          </div>
          {(summary.targetKm > 0 || sessionsBased) && (
            <div className="h-2.5 bg-ghost border-2 border-ink rounded-full overflow-hidden mt-1.5">
              <div className="h-full bg-brocco transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}
          {week.notes && (
            <p className="text-xs text-ink bg-[#faeed8] border-2 border-sun rounded-lg px-2.5 py-1.5 mt-2">{week.notes}</p>
          )}
        </>
      )}

      {lastWeek && lastSummary && (lastSummary.actualKm > 0 || lastSummary.targetKm > 0 || lastSummary.targetSessions > 0) && (
        <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t-2 border-dashed border-shade">
          <p className="label-xs">{t("plan.lastWeek")}</p>
          <p className="text-xs font-bold tabular-nums">
            {isSessionsBased(lastSummary) ? (
              <>
                <span className="text-ink">{lastSummary.sessions}</span>
                <span className="text-sage"> / {lastSummary.targetSessions} {t("common.sessions")}</span>
                {targetHit(lastSummary)
                  ? <span className="text-leaf"> ✓ {t("plan.targetHit")}</span>
                  : <span className="text-clay"> · {lastSummary.targetSessions - lastSummary.sessions} {t("plan.short")}</span>}
              </>
            ) : (
              <>
                <span className="text-ink">{lastSummary.actualKm.toFixed(0)}</span>
                {lastSummary.targetKm > 0 && <span className="text-sage"> / {lastSummary.targetKm.toFixed(0)} {t("common.km")}</span>}
                {lastSummary.targetKm > 0 && (
                  targetHit(lastSummary)
                    ? <span className="text-leaf"> ✓ {t("plan.targetHit")}</span>
                    : <span className="text-clay"> · {(lastSummary.targetKm - lastSummary.actualKm).toFixed(0)} {t("common.km")} {t("plan.short")}</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {goals && goals.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t-2 border-dashed border-shade">
          <WeeklyGoalsTracker goals={goals} variant="bare" />
        </div>
      )}

      {tasks.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t-2 border-dashed border-shade space-y-1">
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => onToggleTask(t.id, t.status === "done" ? "pending" : "done")}
              className="sticker sticker-press w-full flex items-center gap-2 px-3 py-1.5 text-left"
            >
              <span className={`text-xs ${t.status === "done" ? "text-leaf" : "text-sage"}`}>{t.status === "done" ? "☑" : "☐"}</span>
              <span className={`text-xs flex-1 ${t.status === "done" ? "text-moss line-through" : "text-ink font-semibold"}`}>{t.description}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The block at a glance: one bar per week, filled with what was actually run,
 * split at phase boundaries. Weeks are structure here — you read the shape of
 * the build and where you stand in it, never the sessions inside them.
 */
function BlockCard({
  weekList, summaries, phases, currentWeekIdx, currentWeekNum,
}: {
  weekList: PlanWeekData[]; summaries: WeekSummary[]; phases: Phase[];
  currentWeekIdx: number; currentWeekNum: number | undefined;
}) {
  const t = useT();
  // Which phase's description is unfolded. Brocco writes one for every phase
  // it plans; this is the only place they're readable.
  const [openPhaseId, setOpenPhaseId] = useState<string | null>(null);
  const peakKm = Math.max(...summaries.map((s) => s.targetKm), 0);
  // No km anywhere in the block (climbing and other non-distance plans) →
  // the bars show planned sessions instead. km-based blocks are unchanged.
  const sessionsBars = peakKm === 0;
  const peak = sessionsBars ? Math.max(...summaries.map((s) => s.targetSessions), 0) : peakKm;
  if (weekList.length === 0) return null;

  return (
    <section className="sticker px-4 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="label-xs">{t("plan.theBlock")}</p>
        {peak > 0 && (
          <p className="text-xs text-sage font-bold tabular-nums">
            {t("plan.peak")} {peak.toFixed(0)} {sessionsBars ? t("common.sessions") : t("common.km")}
          </p>
        )}
      </div>

      {peak > 0 && (
        <div className="flex items-end gap-[2px] mb-3">
          {weekList.map((w, i) => {
            const s = summaries[i];
            const target = sessionsBars ? s.targetSessions : s.targetKm;
            const actual = sessionsBars ? s.sessions : s.actualKm;
            const startsPhase = i > 0 && phases.some((p) => p.startWeek === w.weekNumber);
            const fill = target > 0 ? Math.min(actual / target, 1) * 100 : 0;
            return (
              <div key={w.id} className="flex items-end gap-[2px] flex-1 min-w-0">
                {startsPhase && <div className="w-px self-stretch bg-shade" />}
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="h-14 flex flex-col justify-end">
                    <div
                      className="w-full rounded-sm bg-shade relative overflow-hidden"
                      style={{ height: `${Math.max((target / peak) * 100, 4)}%` }}
                      title={`${t("common.week")} ${w.weekNumber}: ${target.toFixed(0)} ${sessionsBars ? t("common.sessions") : t("common.km")} target`}
                    >
                      {fill > 0 && <div className="absolute inset-x-0 bottom-0 bg-brocco" style={{ height: `${fill}%` }} />}
                    </div>
                  </div>
                  {/* Tick rail shares the column layout so "you are here" lands under the right bar */}
                  <div className={`h-1 rounded-full ${i === currentWeekIdx ? "bg-ink" : "bg-transparent"}`} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1.5">
        {phases.map((phase) => {
          const len = phase.endWeek - phase.startWeek + 1;
          const isCurrent = currentWeekNum !== undefined && currentWeekNum >= phase.startWeek && currentWeekNum <= phase.endWeek;
          const isDone = currentWeekNum !== undefined && currentWeekNum > phase.endWeek;
          const done = isDone ? len : isCurrent ? currentWeekNum! - phase.startWeek + 1 : 0;
          const expandable = !!phase.description;
          const open = openPhaseId === phase.id;
          return (
            <div key={phase.id}>
              <button
                type="button"
                onClick={() => expandable && setOpenPhaseId(open ? null : phase.id)}
                className={`flex items-center gap-2.5 w-full ${expandable ? "" : "cursor-default"}`}
              >
                <span className={`text-xs font-bold w-24 flex-shrink-0 flex items-center gap-1 ${isCurrent ? "text-ink" : "text-moss"}`}>
                  <span className="truncate">{phase.name}</span>
                  {expandable && <span className="text-sage text-[9px] flex-shrink-0">{open ? "▾" : "▸"}</span>}
                </span>
                <div className="h-2.5 flex-1 bg-ghost border-2 border-ink rounded-full overflow-hidden">
                  <div className={`h-full ${isCurrent ? "bg-brocco" : "bg-sprout"}`} style={{ width: `${(done / len) * 100}%` }} />
                </div>
                <span className="text-[10px] text-sage font-bold tabular-nums w-16 flex-shrink-0 text-right">
                  {isCurrent ? `${done} ${t("plan.weekOf")} ${len}` : `W${phase.startWeek}–${phase.endWeek}`}
                </span>
              </button>
              {open && phase.description && (
                <p className="text-xs text-moss font-semibold mt-1 mb-1 pl-1">{phase.description}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <Link href="/calendar" className="btn-quiet flex items-center justify-center gap-2 flex-1 py-2 text-xs">
          <span>📅</span><span>{t("plan.seeSessions")}</span>
        </Link>
        <Link
          href={`/chat?msg=${encodeURIComponent("Explain my training plan to me — what's the thinking behind the phases and the weekly volumes, and how should I approach the block?")}`}
          className="btn-quiet flex items-center justify-center gap-2 flex-1 py-2 text-xs"
        >
          <span>🥦</span><span>{t("plan.explainPlan")}</span>
        </Link>
      </div>
    </section>
  );
}

/**
 * Every week of the block with its actual numbers — the km that BlockCard's
 * bars only show as relative heights (their exact values otherwise live in a
 * hover tooltip no phone can reach). Rows deep-link into the calendar week.
 */
function WeekListCard({
  weekList, summaries, currentWeekIdx,
}: {
  weekList: PlanWeekData[]; summaries: WeekSummary[]; currentWeekIdx: number;
}) {
  const t = useT();
  const lang = useLang();
  if (weekList.length === 0) return null;

  return (
    <section className="sticker px-4 py-3">
      <p className="label-xs">{t("plan.weekByWeek")}</p>
      <div className="mt-1">
        {weekList.map((w, i) => {
          const s = summaries[i];
          const isCurrent = i === currentWeekIdx;
          // From dates, not the index: in a finished block currentWeekIdx is
          // -1 and every week is past, not upcoming.
          const isPast = !isCurrent && weekDates(w.startDate)[6] < today();
          const startsPhase = !!w.phaseName && (i === 0 || weekList[i - 1].phaseName !== w.phaseName);
          return (
            <div key={w.id}>
              {startsPhase && <p className="label-xs text-sage! mt-2.5 mb-1">{w.phaseName}</p>}
              <Link
                href={`/calendar?view=week&date=${w.startDate.split("T")[0]}`}
                className={`block rounded-lg px-2 py-1.5 -mx-2 ${isCurrent ? "bg-sprout border-2 border-ink" : "hover:bg-ghost"}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`text-xs font-extrabold w-9 flex-shrink-0 tabular-nums ${isCurrent ? "text-ink" : "text-moss"}`}>
                    W{w.weekNumber}
                  </span>
                  <span className="text-[10px] text-sage font-bold w-14 flex-shrink-0">{formatDay(w.startDate, lang)}</span>
                  <span className="text-[10px] text-sage font-semibold flex-1 truncate tracking-[0.2em] uppercase">
                    {(w.sessionTypes || []).join(" ")}
                  </span>
                  <span className="text-xs font-bold tabular-nums flex-shrink-0">
                    {isPast || isCurrent ? (
                      isSessionsBased(s) ? (
                        <>
                          <span className={isPast && targetHit(s) ? "text-leaf" : isPast ? "text-clay" : "text-ink"}>
                            {s.sessions}
                          </span>
                          <span className="text-sage"> / {s.targetSessions} {t("common.sessions")}</span>
                          {isPast && targetHit(s) && <span className="text-leaf"> ✓</span>}
                        </>
                      ) : (
                        <>
                          <span className={isPast && targetHit(s) ? "text-leaf" : isPast ? "text-clay" : "text-ink"}>
                            {s.actualKm.toFixed(0)}
                          </span>
                          {s.targetKm > 0 && <span className="text-sage"> / {s.targetKm.toFixed(0)} {t("common.km")}</span>}
                          {isPast && targetHit(s) && <span className="text-leaf"> ✓</span>}
                        </>
                      )
                    ) : isSessionsBased(s) ? (
                      <span className="text-ink">{s.targetSessions} {t("common.sessions")}</span>
                    ) : (
                      <span className="text-ink">
                        {s.targetKm > 0 ? `${s.targetKm.toFixed(0)} ${t("common.km")}` : "—"}
                        {s.targetSessions > 0 && <span className="text-sage font-semibold"> · {s.targetSessions}×</span>}
                      </span>
                    )}
                  </span>
                </span>
                {w.notes && !isCurrent && (
                  <span className="block text-[10px] text-moss font-semibold truncate mt-0.5 pl-11">{w.notes}</span>
                )}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ============================
// MAIN PAGE
// ============================

export default function PlanPage() {
  return (
    <Suspense fallback={<main className="min-h-screen max-w-2xl mx-auto px-4"><PageHeader /></main>}>
      <PlanPageContent />
    </Suspense>
  );
}

function PlanPageContent() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingPlan, setStartingPlan] = useState(false);
  const goals = useWeeklyGoals();

  useEffect(() => {
    fetch("/api/plan").then((r) => r.json()).then((d) => setPlan(d.plan)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (searchParams.get("new") === "1" && !loading) handleNewPlan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Legacy deep link: /plan?w=<workoutId> used to focus a week of day cards.
  // Session detail lives in Calendar now, so hand it over rather than 404 the
  // expectation.
  useEffect(() => {
    if (searchParams.get("w")) router.replace("/calendar");
  }, [searchParams, router]);

  function handleNewPlan() {
    setStartingPlan(true);
    router.push(`/chat?msg=${encodeURIComponent("I'd like to build a new training plan")}`);
  }

  async function handleToggleTask(id: string, status: string) {
    if (!plan) return;
    setPlan({ ...plan, weeklyTasks: plan.weeklyTasks.map((t) => t.id === id ? { ...t, status } : t) });
    await fetch("/api/plan/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
  }

  const newPlanButton = (
    <button onClick={handleNewPlan} disabled={startingPlan} className="text-xs text-leaf font-bold hover:opacity-70 transition-opacity flex-shrink-0 disabled:opacity-50">
      {startingPlan ? "..." : "+ New plan"}
    </button>
  );

  if (loading) {
    return <main className="min-h-screen max-w-2xl mx-auto px-4"><PageHeader title={t("plan.title")} /><div className="text-moss text-center py-12 font-semibold">{t("common.loading")}</div></main>;
  }

  if (!plan) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4">
        <PageHeader title={t("plan.title")} />
        <div className="text-center py-16">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/brocco-runner.png" alt="" className="h-32 mx-auto mb-4" />
          <p className="text-ink text-lg font-extrabold">{t("plan.noPlan")}</p>
          <p className="text-moss text-sm mt-2 mb-4 font-semibold">Let Brocco build you a personalized plan.</p>
          <button onClick={handleNewPlan} disabled={startingPlan} className="btn-brocco px-6 py-2.5">
            {startingPlan ? "Starting..." : t("today.buildPlan")}
          </button>
        </div>
      </main>
    );
  }

  const workoutsByWeek = new Map<number, Workout[]>();
  for (const w of plan.workouts) {
    if (!workoutsByWeek.has(w.weekNumber)) workoutsByWeek.set(w.weekNumber, []);
    workoutsByWeek.get(w.weekNumber)!.push(w);
  }

  // Older plans have no PlanWeek rows — derive the week skeleton from the
  // workouts so the arc still draws.
  let weekList: PlanWeekData[];
  if (plan.weeks && plan.weeks.length > 0) {
    weekList = plan.weeks;
  } else {
    weekList = Array.from(workoutsByWeek.keys()).sort((a, b) => a - b).map((wn) => {
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

  // findLast, not findIndex: a partial "Week 0" (mid-week start) spans fewer
  // than 7 days but its naive +6 range can overlap Week 1's Monday — picking
  // the last match resolves that in Week 1's favour. Non-overlapping full
  // weeks match exactly once, so this is a no-op for them.
  const currentWeekIdx = weekList.findLastIndex((w) => {
    const dates = weekDates(w.startDate);
    return dates[0] <= today() && dates[6] >= today();
  });
  const currentWeekNum = currentWeekIdx >= 0 ? weekList[currentWeekIdx].weekNumber : undefined;

  const activities = plan.activitiesByDate || {};
  const summaries = weekList.map((w) => summariseWeek(w, workoutsByWeek.get(w.weekNumber) || [], activities));

  const currentPhase = currentWeekNum !== undefined
    ? plan.phases.find((p) => currentWeekNum >= p.startWeek && currentWeekNum <= p.endWeek)
    : undefined;
  const nextPhase = currentPhase ? plan.phases.find((p) => p.orderIndex === currentPhase.orderIndex + 1) : undefined;

  // Position, not weekNumber: plans that open with a partial "Week 0" would
  // otherwise read as "Week 0 of 31".
  const weekPos = currentWeekIdx >= 0 ? currentWeekIdx + 1 : 0;
  const currentTasks = currentWeekNum !== undefined
    ? (plan.weeklyTasks || []).filter((t) => t.weekNumber === currentWeekNum)
    : [];

  const notStarted = currentWeekIdx < 0 && today() < isoOf(new Date(`${plan.startDate.split("T")[0]}T00:00:00`));

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title={plan.name} right={newPlanButton} />

      <div className="mt-3 space-y-3">
        <ArcHeader
          plan={plan}
          phase={currentPhase}
          nextPhase={nextPhase}
          weekPos={weekPos}
          totalWeeks={weekList.length}
          currentWeekNum={currentWeekNum}
        />

        {currentWeekIdx >= 0 ? (
          <ThisWeekCard
            week={weekList[currentWeekIdx]}
            summary={summaries[currentWeekIdx]}
            lastWeek={currentWeekIdx > 0 ? weekList[currentWeekIdx - 1] : undefined}
            lastSummary={currentWeekIdx > 0 ? summaries[currentWeekIdx - 1] : null}
            goals={goals}
            tasks={currentTasks}
            onToggleTask={handleToggleTask}
          />
        ) : (
          <section className="sticker px-4 py-3">
            <p className="text-sm font-bold text-ink">
              {notStarted ? "This block hasn't started yet" : "This block is finished"}
            </p>
            <p className="text-xs text-moss font-semibold mt-0.5">
              {notStarted
                ? `Week 1 begins ${formatDay(weekList[0]?.startDate || plan.startDate, lang)}.`
                : "Ask Brocco for the next one when you're ready."}
            </p>
          </section>
        )}

        <BlockCard
          weekList={weekList}
          summaries={summaries}
          phases={plan.phases}
          currentWeekIdx={currentWeekIdx}
          currentWeekNum={currentWeekNum}
        />

        <WeekListCard
          weekList={weekList}
          summaries={summaries}
          currentWeekIdx={currentWeekIdx}
        />
      </div>
    </main>
  );
}
