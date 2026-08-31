"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { DesktopNavLinks } from "@/app/nav";

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

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function ActivityCard({ activity }: { activity: Activity }) {
  return (
    <Link href={`/activity/${activity.id}`} className="sticker sticker-press block p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-bold text-ink">{activity.name}</h3>
          <p className="text-sm text-moss font-semibold">
            {formatDate(activity.startDateLocal)} &middot; {activity.activityType}
            {activity.source === "manual" && (
              <span className="ml-1 text-xs text-sage">(manual)</span>
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
            <p className="label-xs">Distance</p>
            <p className="text-sm font-bold text-ink">
              {parseFloat(activity.distanceKm).toFixed(1)} km
            </p>
          </div>
        )}
        <div>
          <p className="label-xs">Duration</p>
          <p className="text-sm font-bold text-ink">
            {formatDuration(parseFloat(activity.durationMin))}
          </p>
        </div>
        {activity.avgPacePerKm && (
          <div>
            <p className="label-xs">Pace</p>
            <p className="text-sm font-bold text-ink">{activity.avgPacePerKm}</p>
          </div>
        )}
        {activity.avgHeartRate && (
          <div>
            <p className="label-xs">Avg HR</p>
            <p className="text-sm font-bold text-ink">{activity.avgHeartRate} bpm</p>
          </div>
        )}
        {activity.elevationGainM && parseFloat(activity.elevationGainM) > 0 && (
          <div>
            <p className="label-xs">Elevation</p>
            <p className="text-sm font-bold text-ink">
              {Math.round(parseFloat(activity.elevationGainM))} m
            </p>
          </div>
        )}
      </div>
    </Link>
  );
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
  const [paceCurve, setPaceCurve] = useState<PaceCurveEntry[]>([]);
  const [weeks, setWeeks] = useState<WeekZoneMix[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/trends")
      .then((r) => r.json())
      .then((d) => { setPaceCurve(d.paceCurve || []); setWeeks(d.weeklyZones || []); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const hasZones = weeks.some((w) => w.analyzedMin > 0);
  if (!loaded || (paceCurve.length === 0 && !hasZones)) return null;

  const maxMin = Math.max(...weeks.map((w) => w.zoneMin.reduce((a, b) => a + b, 0)), 1);

  return (
    <div className="mb-6 space-y-4">
      {paceCurve.length > 0 && (
        <div className="sticker p-4">
          <p className="label-xs mb-3">Best efforts · last 90 days</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {paceCurve.map((e) => {
              const improved = e.prevBestTimeSec != null && e.bestTimeSec < e.prevBestTimeSec;
              return (
                <div key={e.distanceM}>
                  <p className="label-xs">{e.label}</p>
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
          <p className="text-[10px] text-sage font-semibold mt-2">vs. the 90 days before — ▼ faster, ▲ slower</p>
        </div>
      )}

      {hasZones && (
        <div className="sticker p-4">
          <p className="label-xs mb-3">Weekly intensity mix (Z1–Z5)</p>
          <div className="flex items-end gap-1.5 h-20">
            {weeks.map((w) => {
              const total = w.zoneMin.reduce((a, b) => a + b, 0);
              return (
                <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${w.label}: ${w.runKm}km${w.hardPct != null ? `, ${w.hardPct}% hard` : ""}`}>
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
              <p key={w.weekStart} className="flex-1 text-center text-[9px] text-sage font-bold">{w.label.split(" ")[1]}</p>
            ))}
          </div>
          <p className="text-[10px] text-sage font-semibold mt-1.5">
            Hard share (Z4+Z5): {weeks.filter((w) => w.hardPct != null).map((w) => `${w.hardPct}%`).join(" · ") || "–"}
          </p>
        </div>
      )}
    </div>
  );
}

export default function HistoryPage() {
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
          <span className="font-extrabold text-sm text-ink">History</span>
          <span className="text-xs text-sage font-bold ml-auto">{total} activities</span>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex items-center justify-between py-3">
          <div>
            <h1 className="text-2xl font-extrabold text-ink">Activity History</h1>
            <p className="text-sm text-moss font-semibold">{total} {total === 1 ? "activity" : "activities"}</p>
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
          <option value="">All types</option>
          <option value="Run">Run</option>
          <option value="Ride">Ride</option>
          <option value="Hike">Hike & Walk</option>
          <option value="Swim">Swim</option>
          <option value="RockClimbing">Climb</option>
          <option value="WeightTraining">Strength</option>
        </select>
      </div>

      {loading ? (
        <div className="text-moss text-center py-12 font-semibold">Loading...</div>
      ) : activities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-moss font-semibold mb-2">No activities yet.</p>
          <p className="text-sage text-sm font-semibold">
            Connect Strava in{" "}
            <Link href="/settings" className="text-leaf font-bold underline">
              Settings
            </Link>{" "}
            to import your runs.
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
                Previous
              </button>
              <span className="text-sm text-moss font-semibold">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-quiet px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
