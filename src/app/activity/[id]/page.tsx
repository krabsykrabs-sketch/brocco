"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ActivityAnalysis } from "@/lib/heart-rate-analysis";
import type { StravaLap } from "@/lib/strava";

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
  avgWatts: number | null;
  calories: number | null;
  perceivedEffort: number | null;
  startDate: string;
  startDateLocal: string;
  splits: Split[] | null;
  laps: StravaLap[] | null;
  activityAnalysis: ActivityAnalysis | null;
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

/**
 * Watch-recorded laps — for structured workouts each step is one lap, so
 * this table IS the interval execution report. Laps meaningfully faster
 * than the run's median pace are highlighted as work reps.
 */
function LapsTable({ laps }: { laps: StravaLap[] }) {
  const paces = laps.map((l) => l.paceSecPerKm).filter((p): p is number => p != null).sort((a, b) => a - b);
  const median = paces.length > 0 ? paces[Math.floor(paces.length / 2)] : null;
  const hasHr = laps.some((l) => l.avgHr != null);
  const hasWatts = laps.some((l) => l.avgWatts != null);
  const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-1.5 pr-3 font-medium">Lap</th>
            <th className="text-right py-1.5 px-3 font-medium">Dist</th>
            <th className="text-right py-1.5 px-3 font-medium">Time</th>
            <th className="text-right py-1.5 px-3 font-medium">Pace</th>
            {hasHr && <th className="text-right py-1.5 px-3 font-medium">HR</th>}
            {hasWatts && <th className="text-right py-1.5 pl-3 font-medium">Power</th>}
          </tr>
        </thead>
        <tbody>
          {laps.map((l) => {
            const isWork = median != null && l.paceSecPerKm != null && l.paceSecPerKm < median * 0.95;
            return (
              <tr key={l.lapIndex} className={`border-b border-gray-900 ${isWork ? "text-white font-medium" : "text-gray-400"}`}>
                <td className="py-1.5 pr-3">
                  {isWork && <span className="text-orange-400 mr-1">▸</span>}
                  {l.name || l.lapIndex}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">
                  {l.distanceM >= 1000 ? `${(l.distanceM / 1000).toFixed(2)}km` : `${l.distanceM}m`}
                </td>
                <td className="py-1.5 px-3 text-right font-mono">{fmtTime(l.movingTimeSec)}</td>
                <td className="py-1.5 px-3 text-right font-mono">{l.paceSecPerKm ? formatPace(l.paceSecPerKm) : "-"}</td>
                {hasHr && <td className="py-1.5 px-3 text-right">{l.avgHr ?? "-"}</td>}
                {hasWatts && <td className="py-1.5 pl-3 text-right">{l.avgWatts ? `${l.avgWatts}W` : "-"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BestEffortChips({ efforts }: { efforts: NonNullable<ActivityAnalysis["bestEfforts"]> }) {
  const fmtTime = (sec: number) =>
    sec >= 3600
      ? `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`
      : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const labels: Record<number, string> = { 1000: "1k", 1609: "1 mile", 5000: "5k", 10000: "10k" };
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Best efforts in this run</p>
      <div className="flex flex-wrap gap-2">
        {efforts.map((e) => (
          <div key={e.distanceM} className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] text-gray-500 mr-1.5">{labels[e.distanceM] || `${e.distanceM}m`}</span>
            <span className="text-xs font-mono text-gray-200">{fmtTime(e.timeSec)}</span>
            <span className="text-[10px] text-gray-500 ml-1.5">{formatPace(e.paceSecPerKm)}</span>
          </div>
        ))}
      </div>
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

const ZONE_META: Array<{ key: keyof NonNullable<ActivityAnalysis["zones"]>; label: string; color: string }> = [
  { key: "z1Pct", label: "Z1 · Very light", color: "#4b5563" },
  { key: "z2Pct", label: "Z2 · Easy", color: "#4ade80" },
  { key: "z3Pct", label: "Z3 · Moderate", color: "#facc15" },
  { key: "z4Pct", label: "Z4 · Hard", color: "#fb923c" },
  { key: "z5Pct", label: "Z5 · Max", color: "#ef4444" },
];

function ZoneBar({ zones }: { zones: NonNullable<ActivityAnalysis["zones"]> }) {
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden bg-gray-800">
        {ZONE_META.map((z) => {
          const pct = zones[z.key];
          if (pct <= 0) return null;
          return <div key={z.key} style={{ width: `${pct}%`, backgroundColor: z.color }} title={`${z.label}: ${pct}%`} />;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {ZONE_META.map((z) => (
          <div key={z.key} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: z.color }} />
            <span className="text-[11px] text-gray-400">{z.label} {zones[z.key]}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const EFFORT_BADGE: Record<string, { label: string; className: string }> = {
  harder_than_planned: { label: "Harder than planned", className: "bg-amber-900/40 border-amber-600/50 text-amber-200" },
  easier_than_planned: { label: "Easier than planned", className: "bg-blue-900/40 border-blue-600/50 text-blue-200" },
};

function EffortSegmentsTable({ segments }: { segments: ActivityAnalysis["effortSegments"] }) {
  if (segments.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-1.5 pr-3 font-medium">Rep</th>
            <th className="text-right py-1.5 px-3 font-medium">Dist</th>
            <th className="text-right py-1.5 px-3 font-medium">Pace</th>
            <th className="text-right py-1.5 px-3 font-medium">HR</th>
            <th className="text-right py-1.5 pl-3 font-medium">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s) => (
            <tr key={s.rep} className="border-b border-gray-900 text-gray-300">
              <td className="py-1.5 pr-3">{s.rep}</td>
              <td className="py-1.5 px-3 text-right font-mono">{(s.distanceM / 1000).toFixed(2)}km</td>
              <td className="py-1.5 px-3 text-right font-mono">{s.paceSecPerKm ? formatPace(s.paceSecPerKm) : "-"}</td>
              <td className="py-1.5 px-3 text-right">{s.avgHr ?? "-"}</td>
              <td className="py-1.5 pl-3 text-right text-gray-500">
                {s.recovery ? `${Math.round(s.recovery.durationSec / 60)}m${s.recovery.avgHr ? ` · HR ${s.recovery.avgHr}` : ""}` : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntensitySection({
  activityId,
  analysis,
  onAnalyzed,
}: {
  activityId: string;
  analysis: ActivityAnalysis | null;
  onAnalyzed: (a: ActivityAnalysis) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/activities/${activityId}/analyze`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        onAnalyzed(data.analysis);
      } else {
        setError(data.error || "Analysis failed");
      }
    } catch {
      setError("Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }

  const badge = analysis?.effortVsPlanned ? EFFORT_BADGE[analysis.effortVsPlanned] : null;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Intensity</h2>
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="text-xs text-gray-500 hover:text-green-400 disabled:opacity-50 transition-colors"
        >
          {analyzing ? "Analyzing..." : analysis ? "Re-analyze" : "Analyze this run"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      {!analysis && !analyzing && !error && (
        <p className="text-xs text-gray-500">
          No intensity analysis yet — pulls second-by-second heart rate and pace from Strava to break down effort by zone.
        </p>
      )}

      {analysis && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
          {badge && (
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg px-2.5 py-1 ${badge.className}`}>
              {badge.label}
            </span>
          )}

          {analysis.zones && <ZoneBar zones={analysis.zones} />}

          <div className="grid grid-cols-2 gap-4">
            {analysis.decouplingPct != null && (
              <Stat
                label="Cardiac drift"
                value={`${analysis.decouplingPct > 0 ? "+" : ""}${analysis.decouplingPct}%`}
              />
            )}
            {analysis.paceFade && (
              <Stat
                label={analysis.paceFade.negativeSplit ? "Negative split" : "Pace fade"}
                value={`${analysis.paceFade.fadePct > 0 ? "+" : ""}${analysis.paceFade.fadePct}%`}
              />
            )}
          </div>

          {analysis.effortSegments.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                {analysis.effortSegments.length > 1 ? "Effort reps" : "Hard effort block"}
              </p>
              <EffortSegmentsTable segments={analysis.effortSegments} />
            </div>
          )}

          {Array.isArray(analysis.bestEfforts) && analysis.bestEfforts.length > 0 && (
            <BestEffortChips efforts={analysis.bestEfforts} />
          )}
        </div>
      )}
    </section>
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
        {activity.avgWatts != null && (
          <Stat label="Avg power" value={`${activity.avgWatts} W`} />
        )}
        {activity.calories != null && activity.calories > 0 && (
          <Stat label="Calories" value={`${activity.calories} kcal`} />
        )}
        {activity.perceivedEffort != null && (
          <Stat label="Effort" value={`${activity.perceivedEffort}/10`} />
        )}
      </div>

      {/* Intensity */}
      <IntensitySection
        activityId={activity.id}
        analysis={activity.activityAnalysis}
        onAnalyzed={(a) => setActivity({ ...activity, activityAnalysis: a })}
      />

      {/* Laps — watch-recorded, one per structured-workout step */}
      {activity.laps && Array.isArray(activity.laps) && activity.laps.length >= 2 && (
        <section className="mb-6">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Laps
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <LapsTable laps={activity.laps} />
          </div>
        </section>
      )}

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
