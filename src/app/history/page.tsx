"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

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
          <span className="text-lg">&#x1F966;</span>
          <span className="font-semibold text-sm text-gray-300">History</span>
          <span className="text-xs text-gray-500 ml-auto">{total} activities</span>
        </div>
        {/* Desktop */}
        <div className="hidden md:flex items-center justify-between py-3">
          <div>
            <h1 className="text-2xl font-bold">Activity History</h1>
            <p className="text-sm text-gray-400">{total} {total === 1 ? "activity" : "activities"}</p>
          </div>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Dashboard
          </Link>
        </div>
      </div>

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
