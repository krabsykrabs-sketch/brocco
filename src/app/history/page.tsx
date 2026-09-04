"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DesktopNavLinks } from "@/app/nav";
import { useT, useFmt } from "@/app/features-provider";
import type { DictKey } from "@/lib/dict";

interface Activity {
  id: string;
  source: string;
  stravaId: string | null;
  name: string;
  activityType: string;
  distanceKm: string | null;
  durationMin: string;
  movingTimeMin: string | null;
  avgPacePerKm: string | null;
  avgHeartRate: number | null;
  elevationGainM: string | null;
  perceivedEffort: number | null;
  startDate: string;
  startDateLocal: string;
}

function formatDuration(mins: number, t: (key: DictKey) => string): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const hu = t("history.hoursShort");
  const mu = t("history.minutesShort");
  return h > 0 ? `${h}${hu} ${m}${mu}` : `${m}${mu}`;
}

function ActivityCard({ activity }: { activity: Activity }) {
  const t = useT();
  const fmt = useFmt();
  const formatDate = (iso: string) => fmt.date(iso, { weekday: "short", day: "numeric", month: "short" });
  return (
    <Link href={`/activity/${activity.id}`} className="sticker sticker-press block p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-bold text-ink">{activity.name}</h3>
          <p className="text-sm text-moss font-semibold">
            {formatDate(activity.startDateLocal)} &middot; {activity.activityType}
            {activity.source === "manual" && (
              <span className="ml-1 text-xs text-sage">{t("history.manual")}</span>
            )}
          </p>
        </div>
        {activity.stravaId && (
          <span className="text-xs text-[#FC4C02] font-bold flex-shrink-0">
            Strava
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {activity.distanceKm && (
          <div>
            <p className="label-xs">{t("history.distance")}</p>
            <p className="text-sm font-bold text-ink">
              {fmt.number(parseFloat(activity.distanceKm), 1)} {t("common.km")}
            </p>
          </div>
        )}
        <div>
          <p className="label-xs">{t("history.duration")}</p>
          <p className="text-sm font-bold text-ink">
            {formatDuration(parseFloat(activity.durationMin), t)}
          </p>
        </div>
        {activity.avgPacePerKm && (
          <div>
            <p className="label-xs">{t("history.pace")}</p>
            <p className="text-sm font-bold text-ink">{activity.avgPacePerKm}</p>
          </div>
        )}
        {activity.avgHeartRate && (
          <div>
            <p className="label-xs">{t("history.avgHr")}</p>
            <p className="text-sm font-bold text-ink">{activity.avgHeartRate} {t("history.bpm")}</p>
          </div>
        )}
        {activity.elevationGainM && parseFloat(activity.elevationGainM) > 0 && (
          <div>
            <p className="label-xs">{t("history.elevation")}</p>
            <p className="text-sm font-bold text-ink">
              {Math.round(parseFloat(activity.elevationGainM))} m
            </p>
          </div>
        )}
      </div>
    </Link>
  );
}

interface WeekSessionMix {
  weekStart: string;
  label: string;
  sessions: number;
  minutes: number;
  byKind: { climb: number; strength: number; run: number; ride: number; other: number };
}

interface PaceCurveEntry {
  distanceM: number; label: string; bestTimeSec: number; paceSecPerKm: number;
  activityName: string; date: string; prevBestTimeSec: number | null;
}
interface WeekZoneMix {
  weekStart: string; label: string; runKm: number; analyzedMin: number;
  zoneMin: [number, number, number, number, number]; hardPct: number | null;
}

function fmtSecs(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const ZONE_COLORS = ["#99a17e", "#9ccb2e", "#e0b23c", "#e8813c", "#d9534c"];

/**
 * 90-day best efforts + 8-week zone mix, computed from stored per-run
 * analyses. Collapsed into a compact card at the top of History.
 */
function TrendsSection() {
  const t = useT();
  const fmt = useFmt();
  const [paceCurve, setPaceCurve] = useState<PaceCurveEntry[]>([]);
  const [weeks, setWeeks] = useState<WeekZoneMix[]>([]);
  const [sessionWeeks, setSessionWeeks] = useState<WeekSessionMix[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/trends")
      .then((r) => r.json())
      .then((d) => { setPaceCurve(d.paceCurve || []); setWeeks(d.weeklyZones || []); setSessionWeeks(d.weeklySessions || []); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const hasZones = weeks.some((w) => w.analyzedMin > 0);
  // Sessions-per-week is the trend every athlete has. Shown whenever there
  // is non-running training in the window, or nothing running-specific to
  // show — a climber's History used to have no trends card at all.
  const nonRunMinutes = sessionWeeks.reduce((s, w) => s + w.minutes - w.byKind.run, 0);
  const hasSessions = sessionWeeks.some((w) => w.sessions > 0) && (nonRunMinutes > 0 || (paceCurve.length === 0 && !hasZones));
  if (!loaded || (paceCurve.length === 0 && !hasZones && !hasSessions)) return null;

  const maxMin = Math.max(...weeks.map((w) => w.zoneMin.reduce((a, b) => a + b, 0)), 1);
  const maxSessionMin = Math.max(...sessionWeeks.map((w) => w.minutes), 1);
  const KIND_COLORS: Record<string, string> = { climb: "#6db3e8", strength: "#e0b23c", run: "#9ccb2e", ride: "#e8813c", other: "#99a17e" };
  const KIND_LABELS: Record<string, string> = {
    climb: t("history.kindClimb"), strength: t("history.kindStrength"), run: t("history.kindRun"), ride: t("history.kindRide"), other: t("history.kindOther"),
  };
  // Week labels come from the API in English ("Jul 14"); weekStart is a plain
  // yyyy-MM-dd so the label is rebuilt here in the app language.
  const weekLabel = (weekStart: string) => fmt.date(weekStart, { day: "numeric", month: "short" });
  const weekDay = (weekStart: string) => fmt.date(weekStart, { day: "numeric" });
  const EFFORT_LABELS: Record<number, string> = { 1000: "1k", 1609: t("history.oneMile"), 5000: "5k", 10000: "10k" };
  const kindsPresent = (["climb", "strength", "run", "ride", "other"] as const).filter((k) => sessionWeeks.some((w) => w.byKind[k] > 0));

  return (
    <div className="mb-6 space-y-4">
      {hasSessions && (
        <div className="sticker p-4">
          <p className="label-xs mb-3">{t("history.sessionsPerWeek")}</p>
          <div className="flex items-end gap-1.5 h-20">
            {sessionWeeks.map((w) => (
              <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${weekLabel(w.weekStart)}: ${w.sessions} ${fmt.plural(w.sessions, t("history.sessionOne"), t("history.sessionMany"))}, ${w.minutes} ${t("common.min")}`}>
                <div className="w-full flex flex-col-reverse rounded-[4px] overflow-hidden" style={{ height: `${(w.minutes / maxSessionMin) * 100}%` }}>
                  {kindsPresent.map((k) =>
                    w.byKind[k] > 0 ? (
                      <div key={k} style={{ height: `${(w.byKind[k] / Math.max(w.minutes, 1)) * 100}%`, backgroundColor: KIND_COLORS[k] }} className="w-full" />
                    ) : null
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-1">
            {sessionWeeks.map((w) => (
              <p key={w.weekStart} className="flex-1 text-center text-[9px] text-sage font-bold">{w.sessions || ""}</p>
            ))}
          </div>
          <p className="text-[10px] text-sage font-semibold mt-1.5">
            {kindsPresent.map((k) => (
              <span key={k} className="mr-2"><span className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ backgroundColor: KIND_COLORS[k] }} />{KIND_LABELS[k]}</span>
            ))}
            · {t("history.numberIsSessions")}
          </p>
        </div>
      )}
      {paceCurve.length > 0 && (
        <div className="sticker p-4">
          <p className="label-xs mb-3">{t("history.bestEfforts90")}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {paceCurve.map((e) => {
              const improved = e.prevBestTimeSec != null && e.bestTimeSec < e.prevBestTimeSec;
              return (
                <div key={e.distanceM}>
                  <p className="label-xs">{EFFORT_LABELS[e.distanceM] || e.label}</p>
                  <p className="text-base font-extrabold text-ink font-mono">{fmtSecs(e.bestTimeSec)}</p>
                  <p className="text-[10px] text-moss font-semibold">
                    {fmtSecs(e.paceSecPerKm)}/km
                    {e.prevBestTimeSec != null && (
                      <span className={improved ? "text-leaf font-bold ml-1" : "text-sage ml-1"}>
                        {improved ? "▼" : "▲"} {fmtSecs(Math.abs(e.bestTimeSec - e.prevBestTimeSec))}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-sage font-semibold mt-2">{t("history.vsPrev90")}</p>
        </div>
      )}

      {hasZones && (
        <div className="sticker p-4">
          <p className="label-xs mb-3">{t("history.weeklyIntensity")}</p>
          <div className="flex items-end gap-1.5 h-20">
            {weeks.map((w) => {
              const total = w.zoneMin.reduce((a, b) => a + b, 0);
              return (
                <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${weekLabel(w.weekStart)}: ${fmt.number(w.runKm, 1, 0)}${t("common.km")}${w.hardPct != null ? `, ${w.hardPct}% ${t("history.hard")}` : ""}`}>
                  <div className="w-full flex flex-col-reverse rounded-[4px] overflow-hidden" style={{ height: `${(total / maxMin) * 100}%` }}>
                    {w.zoneMin.map((min, zi) =>
                      min > 0 ? (
                        <div key={zi} style={{ height: `${(min / Math.max(total, 1)) * 100}%`, backgroundColor: ZONE_COLORS[zi] }} className="w-full" />
                      ) : null
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-1">
            {weeks.map((w) => (
              <p key={w.weekStart} className="flex-1 text-center text-[9px] text-sage font-bold">{weekDay(w.weekStart)}</p>
            ))}
          </div>
          <p className="text-[10px] text-sage font-semibold mt-1.5">
            {t("history.hardShare")}: {weeks.filter((w) => w.hardPct != null).map((w) => `${w.hardPct}%`).join(" · ") || "–"}
          </p>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
  const t = useT();
  const fmt = useFmt();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (typeFilter) params.set("type", typeFilter);

      const res = await fetch(`/api/strava/activities?${params}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data.activities);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6 pb-24">
      <div className="safe-top sticky top-0 z-30 bg-cream/95 backdrop-blur-sm -mx-4 px-4 mb-6">
        {/* Mobile */}
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6 rounded-full border-2 border-ink" />
          <span className="font-extrabold text-sm text-ink">{t("history.title")}</span>
          <span className="text-xs text-sage font-bold ml-auto">{total} {fmt.plural(total, t("history.activityOne"), t("history.activityMany"))}</span>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex items-center justify-between py-3">
          <div>
            <h1 className="text-2xl font-extrabold text-ink">{t("history.activityHistory")}</h1>
            <p className="text-sm text-moss font-semibold">{total} {fmt.plural(total, t("history.activityOne"), t("history.activityMany"))}</p>
          </div>
          <DesktopNavLinks />
        </div>
      </div>

      <TrendsSection />

      <div className="mb-4">
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="field w-auto"
        >
          <option value="">{t("history.all")}</option>
          <option value="Run">{t("history.runs")}</option>
          <option value="Ride">{t("history.rides")}</option>
          <option value="Hike">{t("history.hikeWalk")}</option>
          <option value="Swim">{t("history.swim")}</option>
          <option value="RockClimbing">{t("history.climbs")}</option>
          <option value="WeightTraining">{t("history.strength")}</option>
        </select>
      </div>

      {loading ? (
        <div className="text-moss text-center py-12 font-semibold">{t("common.loading")}</div>
      ) : activities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-moss font-semibold mb-2">{t("history.noActivities")}</p>
          <p className="text-sage text-sm font-semibold">
            {t("history.connectStravaPrefix")}{" "}
            <Link href="/settings" className="text-leaf font-bold underline">
              {t("nav.settings")}
            </Link>{" "}
            {t("history.connectStravaSuffix")}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {activities.map((a) => (
              <ActivityCard key={a.id} activity={a} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-quiet px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("calendar.previous")}
              </button>
              <span className="text-sm text-moss font-semibold">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-quiet px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("calendar.next")}
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
