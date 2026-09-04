"use client";

import { useT, useLang } from "@/app/features-provider";
import { fmtDate, fmtNumber, type Lang } from "@/lib/i18n";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { PageHeader } from "../nav";
import { categoryMeta, getWorkoutTypeColor } from "@/lib/categories";
import { useWeeklyGoals, WeeklyGoalsTracker } from "@/app/weekly-goals-tracker";
import { useScreenContext, useDataChanged } from "@/lib/capture-context";
import { useFeatures } from "../features-provider";
import { anyLifeFeature } from "@/lib/features";
import { isCompatibleType } from "@/lib/activity-types";
import { ResolveButtons } from "@/app/resolve-buttons";

// --- Types (mirror /api/today) ---

interface EventOccurrence {
  eventId: string; occurrenceKey: string; date: string; start: string; end: string | null;
  title: string; location: string | null; notes: string | null; category: string;
  allDay: boolean; recurring: boolean; continuation: boolean;
}
interface WorkoutItem {
  workoutId: string; date: string; title: string; workoutType: string; activityType: string;
  targetDistanceKm: number | null; targetPace: string | null; targetDurationMin: number | null;
  description: string | null; status: string; completed: boolean; detectable: boolean;
}
interface UnconfirmedItem {
  workoutId: string; title: string; date: string; activityType: string; targetDurationMin: number | null;
}
interface ActivityRow {
  id: string; name: string; activityType: string; distanceKm: number | null;
  avgPacePerKm: string | null; avgHeartRate: number | null; durationMin: number | null;
}
interface TodayData {
  date: string; userName: string;
  events: EventOccurrence[]; workouts: WorkoutItem[]; activities: ActivityRow[];
  upcoming: { events: EventOccurrence[]; workouts: WorkoutItem[] };
  unconfirmed: UnconfirmedItem[];
  weekSummary: {
    runKm: number; plannedKm: number; completedSessions: number; totalSessions: number;
    weekNumber: number | null; totalWeeks: number; phaseName: string | null;
    weekStart: string; weekEnd: string;
  };
  hasActivePlan: boolean; planExpired: boolean; activePlanName: string | null;
  stravaConnected: boolean; stravaNeedsReconnect: boolean; activityCount: number;
}

function timeOf(e: EventOccurrence): string {
  return e.allDay ? "" : e.start.slice(11, 16);
}

function formatHeaderDate(dateStr: string, lang: Lang): string {
  return fmtDate(dateStr, lang, { weekday: "long", day: "numeric", month: "long" });
}

function activityDetail(a: ActivityRow, lang: Lang, t: ReturnType<typeof useT>): string {
  return [
    a.distanceKm ? `${fmtNumber(a.distanceKm, lang, 1)} ${t("common.km")}` : null,
    a.avgPacePerKm,
    !a.distanceKm && a.durationMin ? `${Math.round(a.durationMin)} ${t("common.min")}` : null,
  ].filter(Boolean).join(" · ");
}

// --- Agenda rows ---

function EventRow({ event }: { event: EventOccurrence }) {
  const t = useT();
  const meta = categoryMeta(event.category);
  const isLastDay = event.end?.slice(0, 10) === event.date;
  return (
    <div className={`flex items-center gap-3 border-2 rounded-xl px-3.5 py-2.5 shadow-[2px_2px_0_var(--color-shade)] ${event.continuation ? "opacity-80" : ""} ${meta.bg}`}>
      <div className="w-12 flex-shrink-0 text-right">
        {event.continuation ? (
          <span className="text-sm text-moss" title={t("today.continuesFrom")}>⟶</span>
        ) : event.allDay ? (
          <span className="text-[10px] uppercase font-extrabold text-moss">{event.category === "birthday" ? "🎂" : t("today.allDay")}</span>
        ) : (
          <span className="text-sm font-extrabold text-ink tabular-nums">{timeOf(event)}</span>
        )}
      </div>
      <div className="w-1.5 self-stretch rounded-full border border-ink/60" style={{ backgroundColor: meta.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink truncate">{event.title}</p>
        <p className="text-xs text-moss font-semibold truncate">
          {event.continuation
            ? isLastDay && !event.allDay
              ? t("today.endsAt").replace("{t}", event.end!.slice(11, 16))
              : t("today.continuesAllDay")
            : !event.allDay && event.end
            ? t("today.until").replace("{t}", event.end.slice(11, 16))
            : ""}
          {event.location ? `${event.continuation || (!event.allDay && event.end) ? " · " : ""}${event.location}` : ""}
        </p>
      </div>
      {event.recurring && <span className="text-xs text-sage" title={t("today.recurring")}>↻</span>}
    </div>
  );
}

/**
 * Planned | actual, side by side: the plan on the left, what actually
 * happened on the right — real distance/pace instead of a tiny badge.
 */
function WorkoutRow({ workout, matched }: { workout: WorkoutItem; matched: ActivityRow | null }) {
  const t = useT();
  const lang = useLang();
  if (workout.workoutType === "rest") {
    return (
      <div className="flex items-center gap-3 bg-ghost border-2 border-ink/20 rounded-xl px-3.5 py-2.5">
        <div className="w-12 flex-shrink-0 text-right"><span className="text-sm">💤</span></div>
        <p className="text-sm text-moss font-semibold">{t("today.restDay")}</p>
      </div>
    );
  }

  const done = workout.completed || !!matched;
  const details = [
    workout.targetDistanceKm ? `${workout.targetDistanceKm} ${t("common.km")}` : null,
    workout.targetPace,
    workout.targetDurationMin ? `${workout.targetDurationMin} ${t("common.min")}` : null,
  ].filter(Boolean).join(" · ");

  // Strength sessions are playable: deep-link into the guided workout timer
  const isStrength = workout.workoutType === "strength" || workout.activityType === "strength";
  // Session detail lives in the calendar day view now — the plan tab shows the
  // arc, not individual workouts.
  const href = isStrength && !done
    ? `/workout?planned=${workout.workoutId}`
    : matched
      ? `/activity/${matched.id}`
      : `/calendar?view=day&date=${workout.date}`;

  return (
    <Link href={href} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-3.5 py-2.5 border-r-2 border-dashed border-shade min-w-0">
        <p className="label-xs mb-0.5">{t("today.planned")}</p>
        <p className="text-sm font-bold text-ink truncate flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full border border-ink/60 flex-shrink-0" style={{ backgroundColor: getWorkoutTypeColor(workout.workoutType) }} />
          {workout.title}
        </p>
        <p className="text-xs text-moss font-semibold truncate tabular-nums">{details || (isStrength ? t("today.guidedSession") : t("today.trainingPlan"))}</p>
      </div>
      {done ? (
        <div className="px-3.5 py-2.5 bg-sprout min-w-0">
          <p className="label-xs mb-0.5 text-leaf!">✓ {t("common.done")}</p>
          <p className="text-sm font-extrabold text-ink truncate tabular-nums">{matched ? activityDetail(matched, lang, t) || matched.name : t("today.completed")}</p>
          {matched?.avgHeartRate && <p className="text-xs text-leaf font-bold tabular-nums">{Math.round(matched.avgHeartRate)} {t("today.bpm")}</p>}
        </div>
      ) : (
        <div className="px-3.5 py-2.5 bg-ghost min-w-0 flex flex-col justify-center">
          {isStrength ? (
            <span className="btn-brocco self-start px-3 py-1.5 text-xs">{t("common.start")} ▶</span>
          ) : (
            workout.detectable ? (
              <>
                <p className="label-xs mb-0.5">{t("calendar.actual")}</p>
                <p className="text-sm font-bold text-ghost-ink">—</p>
              </>
            ) : (
              <>
                <p className="label-xs mb-1">{t("confirm.didItHappen")}</p>
                <ResolveButtons workoutId={workout.workoutId} compact />
              </>
            )
          )}
        </div>
      )}
    </Link>
  );
}

/** A completed activity with no planned workout behind it. */
function ExtraActivityRow({ activity }: { activity: ActivityRow }) {
  const t = useT();
  const lang = useLang();
  return (
    <Link href={`/activity/${activity.id}`} className="sticker sticker-press grid grid-cols-2 overflow-hidden">
      <div className="px-3.5 py-2.5 border-r-2 border-dashed border-shade bg-ghost min-w-0">
        <p className="label-xs mb-0.5">{t("today.unplanned")}</p>
        <p className="text-sm font-bold text-ghost-ink">— {t("today.spontaneous")}</p>
      </div>
      <div className="px-3.5 py-2.5 bg-sprout min-w-0">
        <p className="label-xs mb-0.5 text-leaf!">✓ {t("common.done")}</p>
        <p className="text-sm font-extrabold text-ink truncate">{activity.name}</p>
        <p className="text-xs text-leaf font-bold truncate tabular-nums">{activityDetail(activity, lang, t)}</p>
      </div>
    </Link>
  );
}

// --- Weekly review card (collapsed to a teaser row until tapped) ---

function WeeklyReviewCard() {
  const t = useT();
  const [review, setReview] = useState<{ text: string; weekStart: string } | null>(null);
  const [dismissed, setDismissed] = useState(true); // assume dismissed until checked
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/weekly-review")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.available || !d.review) return;
        const dismissedWeek = localStorage.getItem("brocco_review_dismissed");
        setDismissed(dismissedWeek === d.weekStart);
        setReview({ text: d.review, weekStart: d.weekStart });
      })
      .catch(() => {});
  }, []);

  if (!review || dismissed) return null;

  return (
    <section className="mb-3">
      <div className="sticker bg-sprout px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
            <p className="label-xs text-leaf!">{t("today.weekReview")}</p>
            <span className={`text-leaf text-xs transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          </button>
          <button
            onClick={() => {
              localStorage.setItem("brocco_review_dismissed", review.weekStart);
              setDismissed(true);
            }}
            className="text-moss hover:text-ink leading-none"
            aria-label={t("today.dismissReview")}
          >
            &times;
          </button>
        </div>
        {open && (
          <p className="text-sm text-ink font-semibold leading-relaxed whitespace-pre-wrap mt-2">{review.text}</p>
        )}
      </div>
    </section>
  );
}

// --- Morning briefing (clamped to two lines until expanded) ---

function BriefingCard({ briefing, loading }: { briefing: string | null; loading: boolean }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const text = briefing || t("today.briefingFallback");
  const isLong = text.length > 120;

  return (
    <section className="mb-4">
      <div className="sticker-lg bg-[#eef6d4] px-4 py-3 flex gap-3 items-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-64.png" alt="" className="w-7 h-7 flex-shrink-0 rounded-full border-2 border-ink" />
        {loading ? (
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 bg-shade/60 rounded animate-pulse w-full" />
            <div className="h-3 bg-shade/60 rounded animate-pulse w-2/3" />
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <p className={`text-sm text-ink font-semibold leading-relaxed ${!expanded && isLong ? "line-clamp-2" : ""}`}>
              {text}
            </p>
            {isLong && (
              <button onClick={() => setExpanded((e) => !e)} className="text-xs text-leaf font-bold mt-0.5">
                {expanded ? t("today.less") : t("today.more")}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Unconfirmed sessions (the app can't detect these; ask once, quietly) ---

function UnconfirmedCard({ items, today }: { items: UnconfirmedItem[]; today: string }) {
  const t = useT();
  const lang = useLang();
  if (items.length === 0) return null;
  const yesterday = new Date(`${today}T00:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  const yIso = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const dayLabel = (iso: string) =>
    iso === yIso ? t("confirm.yesterday") : fmtDate(iso, lang, { weekday: "long" });
  return (
    <section className="mb-3 sticker-lg px-4 py-3">
      <p className="label-xs mb-2">🤔 {t("confirm.didItHappen")}</p>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.workoutId} className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-ink truncate">{it.title}</p>
              <p className="text-xs text-moss font-semibold">
                {dayLabel(it.date)}{it.targetDurationMin ? ` · ${it.targetDurationMin} ${t("common.min")}` : ""}
              </p>
            </div>
            <ResolveButtons workoutId={it.workoutId} />
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Week summary ---

function WeekCard({ data }: { data: TodayData }) {
  const t = useT();
  const lang = useLang();
  const ws = data.weekSummary;
  // A plan week with no km target but planned sessions (climbing and other
  // non-distance plans) is tracked by sessions instead of km.
  const sessionsBased = ws.plannedKm === 0 && ws.totalSessions > 0;
  if (!data.hasActivePlan || (ws.plannedKm === 0 && ws.runKm === 0 && !sessionsBased)) return null;
  const pct = sessionsBased
    ? Math.min((ws.completedSessions / ws.totalSessions) * 100, 150)
    : ws.plannedKm > 0
    ? Math.min((ws.runKm / ws.plannedKm) * 100, 150)
    : 0;
  return (
    <Link href="/plan" className="sticker-lg sticker-press block px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="label-xs">
          {t("today.thisWeek")}{ws.weekNumber ? ` · ${t("plan.weekAbbr")}${ws.weekNumber}${ws.totalWeeks ? `/${ws.totalWeeks}` : ""}` : ""}{ws.phaseName ? ` · ${ws.phaseName}` : ""}
        </p>
        {!sessionsBased && ws.totalSessions > 0 && (
          <p className="text-[10px] text-sage font-bold">{ws.completedSessions}/{ws.totalSessions} {t("common.sessions")}</p>
        )}
      </div>
      <div className="flex items-baseline justify-between mb-1">
        {sessionsBased ? (
          <p className="text-sm text-ink tabular-nums">
            <span className="font-extrabold text-lg">{ws.completedSessions}</span>
            <span className="text-sage font-bold"> / {ws.totalSessions} {t("common.sessions")}</span>
          </p>
        ) : (
          <p className="text-sm text-ink tabular-nums">
            <span className="font-extrabold text-lg">{fmtNumber(ws.runKm, lang, 1)}</span>
            {ws.plannedKm > 0 && <span className="text-sage font-bold"> / {ws.plannedKm.toFixed(0)} {t("common.km")}</span>}
          </p>
        )}
        {(ws.plannedKm > 0 || sessionsBased) && (
          <span className={`text-xs font-extrabold tabular-nums ${pct >= 100 ? "text-leaf" : "text-sage"}`}>{Math.round(pct)}%</span>
        )}
      </div>
      {(ws.plannedKm > 0 || sessionsBased) && (
        <div className="h-2.5 bg-ghost border-2 border-ink rounded-full overflow-hidden">
          <div className="h-full bg-brocco transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
    </Link>
  );
}

// --- Main ---

export default function TodayView() {
  const features = useFeatures();
  const t = useT();
  const lang = useLang();
  const goals = useWeeklyGoals();
  const [data, setData] = useState<TodayData | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    fetch("/api/today")
      .then((r) => {
        if (!r.ok) throw new Error(`today fetch failed: ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(() => {}) // keeps previous data on refetch failure; initial failure -> error state below
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchData();
    fetch("/api/briefing").then((r) => r.json()).then((d) => setBriefing(d.briefing || null)).catch(() => {}).finally(() => setBriefingLoading(false));
    // Weekly outline→detailed promotion (moved from the old dashboard)
    const lastPromo = localStorage.getItem("brocco_last_promo");
    const today = new Date().toISOString().slice(0, 10);
    if (!lastPromo || lastPromo < today) {
      fetch("/api/plan/promote", { method: "POST" }).then(() => localStorage.setItem("brocco_last_promo", today)).catch(() => {});
    }
  }, [fetchData]);

  useScreenContext(
    { name: "today", rangeStart: data?.date, rangeEnd: data?.date },
    [data?.date]
  );
  useDataChanged(["calendar", "tasks", "plan", "activities", "health"], fetchData);

  if (loading || !data) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4">
        <PageHeader title={t("today.title")} />
        <div className="text-moss text-center py-12 font-semibold">{loading ? t("common.loading") : t("today.failedLoad")}</div>
      </main>
    );
  }

  // Sort agenda: all-day events + birthdays + multi-day continuations →
  // timed events by time → workout.
  // Continuations sort with all-day items — their start time belongs to a
  // previous day and would mis-position them in today's timeline.
  const allDayEvents = data.events.filter((e) => e.allDay || e.continuation);
  const timedEvents = data.events.filter((e) => !e.allDay && !e.continuation);

  const timedRows: Array<{ key: string; time: string; node: React.ReactNode }> = [
    ...timedEvents.map((e) => ({ key: e.occurrenceKey, time: timeOf(e), node: <EventRow key={e.occurrenceKey} event={e} /> })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  // Planned ↔ done reconciliation (same rule as calendar): each non-rest
  // workout claims the first compatible unused activity; leftovers render
  // as unplanned side-by-side rows.
  const usedActivities = new Set<string>();
  const workoutRows = data.workouts.map((w) => {
    if (w.workoutType === "rest") return { workout: w, matched: null };
    const matched =
      data.activities.find((a) => !usedActivities.has(a.id) && isCompatibleType(w.activityType, a.activityType)) || null;
    if (matched) usedActivities.add(matched.id);
    return { workout: w, matched };
  });
  const extraActivities = data.activities.filter((a) => !usedActivities.has(a.id));
  const visibleWorkoutRows = workoutRows.filter(
    ({ workout }) => workout.workoutType !== "rest" || (data.workouts.length === 1 && extraActivities.length === 0)
  );

  const isEmptyDay =
    allDayEvents.length === 0 && timedRows.length === 0 && visibleWorkoutRows.length === 0 &&
    extraActivities.length === 0;
  const showNewUserCTAs = !data.hasActivePlan && !data.planExpired;

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 pb-28 md:pb-12">
      <PageHeader title={t("today.title")} />

      {/* Date + greeting */}
      <div className="mt-3 mb-3">
        <h1 className="text-xl font-extrabold text-ink">{formatHeaderDate(data.date, lang)}</h1>
      </div>

      {/* Strava connection broke (token revoked/expired) — without this
          banner, runs just silently stop appearing */}
      {data.stravaNeedsReconnect && (
        <div className="mb-3 bg-clay-soft border-2 border-clay rounded-xl px-3.5 py-3 flex items-center gap-3">
          <span className="text-xl flex-shrink-0">⚠️</span>
          <p className="text-sm text-clay font-bold flex-1">{t("today.stravaBroken")}</p>
          <a href="/api/strava/auth" className="btn-brocco px-3 py-1.5 text-xs flex-shrink-0">{t("today.reconnect")}</a>
        </div>
      )}

      {/* Morning briefing */}
      <BriefingCard briefing={briefing} loading={briefingLoading} />

      {/* Sessions the app couldn't detect — one quiet question, gone once answered */}
      <UnconfirmedCard items={data.unconfirmed || []} today={data.date} />

      {/* Weekly review (Sunday evening / Monday only) */}
      <WeeklyReviewCard />

      {/* Plan expired prompt */}
      {data.planExpired && (
        <div className="mb-3 sticker px-3.5 py-3 flex items-center gap-3">
          <span className="text-xl flex-shrink-0">🏁</span>
          <p className="text-sm text-ink font-bold flex-1">{data.activePlanName || t("today.yourPlan")} {t("today.planDone")}</p>
          <Link href={`/chat?msg=${encodeURIComponent(t("plan.msgNewPlan"))}`} className="btn-brocco px-3 py-1.5 text-xs flex-shrink-0">{t("today.buildPlan")}</Link>
        </div>
      )}


      {/* New user CTAs (compact — life features work regardless) */}
      {/* New-user CTAs. Strava leads while it's disconnected — Brocco learns
          far more from a real history than from interview answers, so the
          plan CTA steps back to secondary until it's linked. */}
      {showNewUserCTAs && (
        <div className="mb-4 space-y-2">
          {!data.stravaConnected ? (
            <>
              <Link href="/api/strava/auth?returnTo=/today" className="btn-brocco flex items-center gap-3 px-4 py-3">
                <span className="text-lg">🏃</span>
                <div className="flex-1 text-left">
                  <p className="text-sm font-extrabold">{t("today.connectStravaFirst")}</p>
                  <p className="text-xs text-leaf font-bold">{t("today.connectStravaFirstSub")}</p>
                </div>
              </Link>
              <Link href={`/chat?msg=${encodeURIComponent(t("today.msgBuildPlan"))}`} className="sticker sticker-press flex items-center gap-3 px-4 py-3">
                <span className="text-lg">💬</span>
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink">{t("today.buildWithout")}</p>
                  <p className="text-xs text-moss font-semibold">{t("today.buildWithoutSub")}</p>
                </div>
              </Link>
            </>
          ) : (
            <Link href={`/chat?msg=${encodeURIComponent(t("today.msgBuildPlan"))}`} className="btn-brocco flex items-center gap-3 px-4 py-3">
              <span className="text-lg">💬</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-extrabold">{t("today.buildMyPlan")}</p>
                <p className="text-xs text-leaf font-bold">{t("today.buildMyPlanSub")}</p>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Agenda */}
      <section className="space-y-2 mb-4">
        {allDayEvents.map((e) => <EventRow key={e.occurrenceKey} event={e} />)}
        {timedRows.map((r) => r.node)}
        {visibleWorkoutRows.map(({ workout, matched }) => (
          <WorkoutRow key={workout.workoutId} workout={workout} matched={matched} />
        ))}
        {extraActivities.map((a) => <ExtraActivityRow key={a.id} activity={a} />)}

        {isEmptyDay && (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">🌤️</p>
            <p className="text-ink text-sm font-bold">
              {anyLifeFeature(features) ? t("today.clearDay") : t("today.noTraining")}
            </p>
            <p className="text-moss text-xs mt-1 font-semibold">
              {anyLifeFeature(features)
                ? t("today.nothingScheduledAsk")
                : t("today.restUp")}
            </p>
          </div>
        )}
      </section>

      {/* Week summary — the "am I on track this week" half of this tab */}
      <section className="mb-4 space-y-2">
        <WeekCard data={data} />
        <WeeklyGoalsTracker goals={goals} />
      </section>

      {/* Ask Brocco */}
      <section>
        <Link href="/chat" className="btn-quiet flex items-center justify-center gap-2 w-full py-2.5 text-sm">
          <span>💬</span><span>{t("today.openChat")}</span>
        </Link>
      </section>
    </main>
  );
}
