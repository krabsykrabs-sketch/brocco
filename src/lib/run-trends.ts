import { prisma } from "@/lib/db";
import { subDays, subWeeks, startOfWeek, endOfWeek, format } from "date-fns";
import { RUN_TYPES } from "@/lib/activity-types";
import type { ActivityAnalysis } from "@/lib/heart-rate-analysis";

/**
 * Aggregations over stored per-activity analyses (activity_analysis jsonb):
 * rolling best-effort pace curve and weekly HR-zone mix. Pure reads — the
 * expensive work (streams fetch + analysis) already happened at sync time.
 */

export interface PaceCurveEntry {
  distanceM: number;
  label: string;
  bestTimeSec: number;
  paceSecPerKm: number;
  activityName: string;
  date: string; // yyyy-MM-dd
  prevBestTimeSec: number | null; // best in the window before this one
}

const DISTANCE_LABELS: Record<number, string> = {
  1000: "1k",
  1609: "1 mile",
  5000: "5k",
  10000: "10k",
};

export async function getPaceCurve(userId: string, days = 90): Promise<PaceCurveEntry[]> {
  const now = new Date();
  const activities = await prisma.activity.findMany({
    where: {
      userId,
      activityType: { in: RUN_TYPES },
      startDateLocal: { gte: subDays(now, days * 2) },
      activityAnalysis: { not: { equals: null } },
    },
    select: { name: true, startDateLocal: true, activityAnalysis: true },
  });

  const cutoff = subDays(now, days);
  const current = new Map<number, { timeSec: number; name: string; date: Date }>();
  const previous = new Map<number, number>();

  for (const a of activities) {
    const analysis = a.activityAnalysis as unknown as ActivityAnalysis | null;
    const efforts = analysis?.bestEfforts;
    if (!Array.isArray(efforts)) continue;
    const isCurrent = a.startDateLocal >= cutoff;
    for (const e of efforts) {
      if (isCurrent) {
        const best = current.get(e.distanceM);
        if (!best || e.timeSec < best.timeSec) {
          current.set(e.distanceM, { timeSec: e.timeSec, name: a.name, date: a.startDateLocal });
        }
      } else {
        const best = previous.get(e.distanceM);
        if (!best || e.timeSec < best) previous.set(e.distanceM, e.timeSec);
      }
    }
  }

  return [...current.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([distanceM, best]) => ({
      distanceM,
      label: DISTANCE_LABELS[distanceM] || `${distanceM}m`,
      bestTimeSec: best.timeSec,
      paceSecPerKm: Math.round(best.timeSec / (distanceM / 1000)),
      activityName: best.name,
      date: format(best.date, "yyyy-MM-dd"),
      prevBestTimeSec: previous.get(distanceM) ?? null,
    }));
}

export interface WeekZoneMix {
  weekStart: string; // yyyy-MM-dd (Monday)
  label: string; // "Jul 14"
  runKm: number;
  analyzedMin: number; // minutes of running covered by HR analysis
  zoneMin: [number, number, number, number, number]; // Z1..Z5 minutes
  hardPct: number | null; // (Z4+Z5) share of analyzed time; null if no HR data
}

export async function getWeeklyZoneMix(userId: string, weeks = 8): Promise<WeekZoneMix[]> {
  const now = new Date();
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const rangeStart = subWeeks(thisWeekStart, weeks - 1);

  const activities = await prisma.activity.findMany({
    where: {
      userId,
      activityType: { in: RUN_TYPES },
      startDateLocal: { gte: rangeStart },
    },
    select: { startDateLocal: true, distanceKm: true, movingTimeMin: true, durationMin: true, activityAnalysis: true },
  });

  const rows: WeekZoneMix[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = subWeeks(thisWeekStart, i);
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const weekActs = activities.filter((a) => a.startDateLocal >= ws && a.startDateLocal <= we);

    let runKm = 0;
    let analyzedMin = 0;
    const zoneMin: [number, number, number, number, number] = [0, 0, 0, 0, 0];

    for (const a of weekActs) {
      runKm += a.distanceKm ? Number(a.distanceKm) : 0;
      const analysis = a.activityAnalysis as unknown as ActivityAnalysis | null;
      const z = analysis?.zones;
      if (!z) continue;
      const min = Number(a.movingTimeMin ?? a.durationMin);
      analyzedMin += min;
      zoneMin[0] += (min * z.z1Pct) / 100;
      zoneMin[1] += (min * z.z2Pct) / 100;
      zoneMin[2] += (min * z.z3Pct) / 100;
      zoneMin[3] += (min * z.z4Pct) / 100;
      zoneMin[4] += (min * z.z5Pct) / 100;
    }

    rows.push({
      weekStart: format(ws, "yyyy-MM-dd"),
      label: format(ws, "MMM d"),
      runKm: Math.round(runKm * 10) / 10,
      analyzedMin: Math.round(analyzedMin),
      zoneMin: zoneMin.map((m) => Math.round(m)) as WeekZoneMix["zoneMin"],
      hardPct: analyzedMin > 0 ? Math.round(((zoneMin[3] + zoneMin[4]) / analyzedMin) * 100) : null,
    });
  }
  return rows;
}

/** "22:41" / "1:02:41" from seconds. */
export function formatTimeSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** "4:32/km" from seconds per km. */
export function formatPaceSec(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
