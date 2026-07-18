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
    <Link href={`/activity/${activity.id}`} className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-medium text-white">{activity.name}</h3>
          <p className="text-sm text-gray-400">
            {formatDate(activity.startDateLocal)} &middot; {activity.activityType}
            {activity.source === "manual" && (
              <span className="ml-1 text-xs text-gray-500">(manual)</span>
            )}
          </p>
        </div>
        {activity.stravaId && (
          <span className="text-xs text-[#FC4C02] flex-shrink-0">
            Strava
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {activity.distanceKm && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Distance</p>
            <p className="text-sm font-medium text-white">
              {parseFloat(activity.distanceKm).toFixed(1)} km
            </p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Duration</p>
          <p className="text-sm font-medium text-white">
            {formatDuration(parseFloat(activity.durationMin))}
          </p>
        </div>
        {activity.avgPacePerKm && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Pace</p>
            <p className="text-sm font-medium text-white">{activity.avgPacePerKm}</p>
          </div>
        )}
        {activity.avgHeartRate && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg HR</p>
            <p className="text-sm font-medium text-white">{activity.avgHeartRate} bpm</p>
          </div>
        )}
        {activity.elevationGainM && parseFloat(activity.elevationGainM) > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Elevation</p>
            <p className="text-sm font-medium text-white">
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

const ZONE_COLORS = ["#4b5563", "#4ade80", "#facc15", "#fb923c", "#ef4444"];

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
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Best efforts · last 90 days</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {paceCurve.map((e) => {
              const improved = e.prevBestTimeSec != null && e.bestTimeSec < e.prevBestTimeSec;
              return (
                <div key={e.distanceM}>
                  <p className="text-[10px] text-gray-500 uppercase">{e.label}</p>
                  <p className="text-base font-semibold text-white font-mono">{fmtSecs(e.bestTimeSec)}</p>
                  <p className="text-[10px] text-gray-500">
                    {fmtSecs(e.paceSecPerKm)}/km
                    {e.prevBestTimeSec != null && (
                      <span className={improved ? "text-green-400 ml-1" : "text-gray-600 ml-1"}>
                        {improved ? "▼" : "▲"} {fmtSecs(Math.abs(e.bestTimeSec - e.prevBestTimeSec))}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-600 mt-2">vs. the 90 days before — ▼ faster, ▲ slower</p>
        </div>
      )}

      {hasZones && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Weekly intensity mix (Z1–Z5)</p>
          <div className="flex items-end gap-1.5 h-20">
            {weeks.map((w) => {
              const total = w.zoneMin.reduce((a, b) => a + b, 0);
              return (
                <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${w.label}: ${w.runKm}km${w.hardPct != null ? `, ${w.hardPct}% hard` : ""}`}>
                  <div className="w-full flex flex-col-reverse" style={{ height: `${(total / maxMin) * 100}%` }}>
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
              <p key={w.weekStart} className="flex-1 text-center text-[9px] text-gray-600">{w.label.split(" ")[1]}</p>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 mt-1.5">
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
      <div className="safe-top sticky top-0 z-30 bg-gray-950/95 backdrop-blur-sm -mx-4 px-4 mb-6">
        {/* Mobile */}
        <div className="md:hidden flex items-center gap-2 pb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-64.png" alt="Brocco" className="w-6 h-6" />
          <span className="font-semibold text-sm text-gray-300">History</span>
          <span className="text-xs text-gray-500 ml-auto">{total} activities</span>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex items-center justify-between py-3">
          <div>
            <h1 className="text-2xl font-bold">Activity History</h1>
            <p className="text-sm text-gray-400">{total} {total === 1 ? "activity" : "activities"}</p>
          </div>
          <DesktopNavLinks />
        </div>
      </div>

      <TrendsSection />

      <div className="mb-4">
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
        >
          <option value="">All types</option>
          <option value="Run">Run</option>
          <option value="Ride">Ride</option>
          <option value="Hike">Hike</option>
          <option value="Walk">Walk</option>
          <option value="Swim">Swim</option>
          <option value="WeightTraining">Strength</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-center py-12">Loading...</div>
      ) : activities.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 mb-2">No activities yet.</p>
          <p className="text-gray-600 text-sm">
            Connect Strava in{" "}
            <Link href="/settings" className="text-green-400 underline">
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
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
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
