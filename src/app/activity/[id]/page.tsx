"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

interface Split {
  distance: number;
  elapsed_time: number;
  moving_time: number;
  average_heartrate?: number;
  average_speed?: number;
  split: number;
}

interface MatchedWorkout {
  id: string;
  title: string;
  workoutType: string;
  targetDistanceKm: number | null;
  targetPace: string | null;
  targetDurationMin: number | null;
  description: string | null;
}

interface ActivityDetail {
  id: string;
  source: string;
  stravaId: string | null;
  name: string;
  activityType: string;
  distanceKm: number | null;
  durationMin: number;
  movingTimeMin: number | null;
  avgPacePerKm: string | null;
  paceSecondsPerKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  elevationGainM: number | null;
  avgCadence: number | null;
  calories: number | null;
  perceivedEffort: number | null;
  startDate: string;
  startDateLocal: string;
  splits: Split[] | null;
  matchedWorkout: MatchedWorkout | null;
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPace(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

function getWorkoutTypeColor(type: string): string {
  switch (type) {
    case "easy":
    case "recovery": return "#4ade80";
    case "tempo": return "#fb923c";
    case "interval": return "#ef4444";
    case "race_pace": return "#ea580c";
    case "long": return "#3b82f6";
    case "cross_training": return "#14b8a6";
    case "strength": return "#a855f7";
    case "rest": return "#6b7280";
    case "race": return "#eab308";
    default: return "#6b7280";
  }
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-white mt-0.5">{value}</p>
    </div>
  );
}

function SplitsTable({ splits }: { splits: Split[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-1.5 pr-3 font-medium">KM</th>
            <th className="text-right py-1.5 px-3 font-medium">Pace</th>
            <th className="text-right py-1.5 px-3 font-medium">HR</th>
            <th className="text-right py-1.5 pl-3 font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {splits.map((s, i) => {
            const distKm = s.distance / 1000;
            const paceSeconds = distKm > 0 ? Math.round(s.moving_time / distKm) : 0;
            const paceMin = Math.floor(paceSeconds / 60);
            const paceSec = paceSeconds % 60;
            const elapsed = Math.round(s.moving_time);
            const eMin = Math.floor(elapsed / 60);
            const eSec = elapsed % 60;
            return (
              <tr key={i} className="border-b border-gray-900 text-gray-300">
                <td className="py-1.5 pr-3">{s.split || i + 1}</td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {paceMin}:{paceSec.toString().padStart(2, "0")}
                </td>
                <td className="py-1.5 px-3 text-right">
                  {s.average_heartrate ? Math.round(s.average_heartrate) : "-"}
                </td>
                <td className="py-1.5 pl-3 text-right font-mono">
                  {eMin}:{eSec.toString().padStart(2, "0")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ActivityDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/activities/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => setActivity(d.activity))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <div className="text-gray-500 text-center py-12">Loading...</div>
      </main>
    );
  }

  if (error || !activity) {
    return (
      <main className="min-h-screen max-w-2xl mx-auto px-4 py-6">
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">Activity not found.</p>
          <Link href="/history" className="text-green-400 hover:underline text-sm">
            Back to history
          </Link>
        </div>
      </main>
    );
  }

  const dateStr = new Date(activity.startDateLocal).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = new Date(activity.startDateLocal).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const mw = activity.matchedWorkout;

  return (
    <main className="min-h-screen max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/history"
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          &larr; History
        </Link>
        {activity.stravaId && (
          <a
            href={`https://www.strava.com/activities/${activity.stravaId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[#FC4C02] hover:underline"
          >
            View on Strava
          </a>
        )}
      </div>

      {/* Title */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">{activity.name}</h1>
        <p className="text-sm text-gray-400 mt-1">
          {dateStr} at {timeStr} &middot; {activity.activityType}
          {activity.source === "manual" && (
            <span className="ml-1 text-gray-500">(manual)</span>
          )}
        </p>
      </div>

      {/* Matched workout comparison */}
      {mw && (
        <div className="mb-6 bg-green-900/20 border border-green-800/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: getWorkoutTypeColor(mw.workoutType) }}
            />
            <span className="text-sm font-medium text-gray-200">
              Matched: {mw.title}
            </span>
          </div>
          <p className="text-sm text-gray-300">
            <span className="text-gray-500">Planned:</span>{" "}
            {mw.targetDistanceKm && `${mw.targetDistanceKm}km`}
            {mw.targetDistanceKm && mw.targetPace && " "}
            {mw.workoutType} {mw.targetPace && `@ ${mw.targetPace}`}
            {" → "}
            <span className="text-gray-500">Actual:</span>{" "}
            {activity.distanceKm && `${activity.distanceKm.toFixed(1)}km`}
            {activity.avgPacePerKm && ` @ ${activity.avgPacePerKm} avg`}
            {activity.avgHeartRate && `, HR ${activity.avgHeartRate}`}
          </p>
          {mw.description && (
            <p className="text-xs text-gray-500 mt-1">{mw.description}</p>
          )}
        </div>
      )}

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {activity.distanceKm != null && (
          <Stat label="Distance" value={`${activity.distanceKm.toFixed(2)} km`} />
        )}
        <Stat label="Duration" value={formatDuration(activity.durationMin)} />
        {activity.movingTimeMin != null && activity.movingTimeMin !== activity.durationMin && (
          <Stat label="Moving time" value={formatDuration(activity.movingTimeMin)} />
        )}
        {activity.avgPacePerKm && (
          <Stat label="Avg pace" value={activity.avgPacePerKm} />
        )}
        {activity.avgHeartRate != null && (
          <Stat label="Avg HR" value={`${activity.avgHeartRate} bpm`} />
        )}
        {activity.maxHeartRate != null && (
          <Stat label="Max HR" value={`${activity.maxHeartRate} bpm`} />
        )}
        {activity.elevationGainM != null && activity.elevationGainM > 0 && (
          <Stat label="Elevation" value={`${Math.round(activity.elevationGainM)} m`} />
        )}
        {activity.avgCadence != null && (
          <Stat label="Cadence" value={`${activity.avgCadence} spm`} />
        )}
        {activity.calories != null && activity.calories > 0 && (
          <Stat label="Calories" value={`${activity.calories} kcal`} />
        )}
        {activity.perceivedEffort != null && (
          <Stat label="Effort" value={`${activity.perceivedEffort}/10`} />
        )}
      </div>

      {/* Splits */}
      {activity.splits && Array.isArray(activity.splits) && activity.splits.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Splits
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <SplitsTable splits={activity.splits} />
          </div>
        </section>
      )}
    </main>
  );
}
