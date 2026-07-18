/**
 * Pure signal-processing functions that turn a Strava activity's raw
 * second-by-second streams into compact, storable intensity metrics.
 * No I/O here — src/lib/strava.ts fetches + normalizes streams into
 * StreamPoint[] and calls analyzeStreams(). Kept pure so it's trivially
 * unit-testable against synthetic data.
 */

export interface StreamPoint {
  t: number; // seconds elapsed since activity start
  distanceM: number; // cumulative distance in meters
  velocityMps: number; // Strava's smoothed instantaneous speed, m/s
  hr: number | null; // bpm; null if no HR strap data at this sample
  moving: boolean; // false during paused/stopped time (traffic lights, etc.)
}

export interface ZonePct {
  z1Pct: number; // <60% max HR — very light / warmup
  z2Pct: number; // 60-70% — easy / aerobic
  z3Pct: number; // 70-80% — moderate / tempo
  z4Pct: number; // 80-90% — hard / threshold
  z5Pct: number; // 90%+ — max / anaerobic
}

export interface PaceFade {
  firstThirdPaceSecPerKm: number;
  lastThirdPaceSecPerKm: number;
  fadePct: number; // positive = slower at the end (faded); negative = negative split
  negativeSplit: boolean;
}

export interface EffortSegment {
  rep: number;
  durationSec: number;
  distanceM: number;
  paceSecPerKm: number | null;
  avgHr: number | null;
  recovery: { durationSec: number; avgHr: number | null } | null;
}

export type EffortVerdict = "harder_than_planned" | "easier_than_planned" | "as_planned";

export interface BestEffort {
  distanceM: number; // target distance (1000, 1609, 5000, 10000)
  timeSec: number; // fastest rolling time over that distance in this run
  paceSecPerKm: number;
}

export interface ActivityAnalysis {
  version: 2;
  maxHrUsed: number;
  zones: ZonePct | null;
  decouplingPct: number | null;
  paceFade: PaceFade | null;
  effortSegments: EffortSegment[];
  effortVsPlanned: EffortVerdict | null;
  bestEfforts: BestEffort[];
  analyzedAt: string;
}

// --- small utils ---

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function average(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// --- HR zone breakdown ---

/**
 * Duration-weighted (not sample-count-weighted) so it stays accurate even
 * when Strava downsamples long activities to irregular intervals. Gaps
 * between samples are capped at 5s so a pause/dropout doesn't get counted
 * as one long zone-holding.
 */
export function computeZoneBreakdown(points: StreamPoint[], maxHr: number): ZonePct | null {
  const buckets = [0, 0, 0, 0, 0];
  let totalSec = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    if (!p.moving || p.hr == null) continue;
    const dt = Math.min(points[i + 1].t - p.t, 5);
    if (dt <= 0) continue;
    const frac = p.hr / maxHr;
    const zoneIdx = frac < 0.6 ? 0 : frac < 0.7 ? 1 : frac < 0.8 ? 2 : frac < 0.9 ? 3 : 4;
    buckets[zoneIdx] += dt;
    totalSec += dt;
  }

  if (totalSec < 60) return null; // not enough HR coverage to mean anything

  return {
    z1Pct: round1((buckets[0] / totalSec) * 100),
    z2Pct: round1((buckets[1] / totalSec) * 100),
    z3Pct: round1((buckets[2] / totalSec) * 100),
    z4Pct: round1((buckets[3] / totalSec) * 100),
    z5Pct: round1((buckets[4] / totalSec) * 100),
  };
}

// --- Cardiac decoupling (aerobic efficiency drift) ---

/**
 * Uses the standard "efficiency factor" (speed / HR) comparison between the
 * first and second half of the moving time, not a naive HR delta — a naive
 * delta conflates "HR rose because fatigue" with "HR rose because pace
 * picked up". EF drift isolates the fatigue signal. Positive % = efficiency
 * dropped (drift/fatigue); requires >=10 minutes of data to be meaningful.
 */
export function computeCardiacDecoupling(points: StreamPoint[]): number | null {
  const usable = points.filter((p) => p.moving && p.hr != null && p.velocityMps > 0);
  if (usable.length < 60) return null;

  const totalT = usable[usable.length - 1].t - usable[0].t;
  if (totalT < 600) return null;

  const midT = usable[0].t + totalT / 2;
  const firstHalf = usable.filter((p) => p.t <= midT);
  const secondHalf = usable.filter((p) => p.t > midT);
  if (firstHalf.length < 10 || secondHalf.length < 10) return null;

  const efficiencyFactor = (pts: StreamPoint[]) => {
    const avgV = average(pts.map((p) => p.velocityMps));
    const avgHr = average(pts.map((p) => p.hr as number));
    return avgHr > 0 ? avgV / avgHr : null;
  };

  const ef1 = efficiencyFactor(firstHalf);
  const ef2 = efficiencyFactor(secondHalf);
  if (!ef1 || !ef2) return null;

  return round1(((ef1 - ef2) / ef1) * 100);
}

// --- Pace fade (positive/negative split) ---

/** Split by distance (not time) into thirds — the natural unit for pacing strategy. */
export function computePaceFade(points: StreamPoint[]): PaceFade | null {
  const moving = points.filter((p) => p.moving);
  if (moving.length < 30) return null;

  const d0 = moving[0].distanceM;
  const totalDist = moving[moving.length - 1].distanceM - d0;
  if (totalDist < 1500) return null; // too short for "thirds" to mean anything

  const thirdDist = totalDist / 3;
  const firstThird = moving.filter((p) => p.distanceM - d0 <= thirdDist);
  const lastThird = moving.filter((p) => p.distanceM - d0 >= thirdDist * 2);

  const paceOf = (pts: StreamPoint[]): number | null => {
    if (pts.length < 2) return null;
    const dist = pts[pts.length - 1].distanceM - pts[0].distanceM;
    const time = pts[pts.length - 1].t - pts[0].t;
    return dist > 0 ? time / (dist / 1000) : null;
  };

  const p1 = paceOf(firstThird);
  const p3 = paceOf(lastThird);
  if (!p1 || !p3) return null;

  const fadePct = ((p3 - p1) / p1) * 100;
  return {
    firstThirdPaceSecPerKm: Math.round(p1),
    lastThirdPaceSecPerKm: Math.round(p3),
    fadePct: round1(fadePct),
    negativeSplit: fadePct < -2,
  };
}

// --- Effort segment (interval / tempo-block) detection ---

const MIN_REP_SECONDS = 20;
const SMOOTH_WINDOW_SEC = 15;

/** Two-pointer centered moving average over time — O(n), robust to irregular sample spacing. */
function smoothVelocityByTime(points: StreamPoint[], windowSec: number): number[] {
  const result = new Array<number>(points.length);
  const half = windowSec / 2;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < points.length; i++) {
    while (hi < points.length && points[hi].t - points[i].t <= half) {
      sum += points[hi].velocityMps;
      count++;
      hi++;
    }
    while (lo < i && points[i].t - points[lo].t > half) {
      sum -= points[lo].velocityMps;
      count--;
      lo++;
    }
    result[i] = count > 0 ? sum / count : points[i].velocityMps;
  }
  return result;
}

/**
 * Adaptive threshold (not a fixed pace) so this works across paces/abilities:
 * "hard" = meaningfully faster than the run's own median pace. This also
 * means a single sustained tempo block gets reported as one "rep" — useful
 * on its own, since it isolates true tempo pace/HR from warmup/cooldown
 * padding that otherwise dilutes the whole-activity average.
 */
export function detectEffortSegments(points: StreamPoint[]): EffortSegment[] {
  const moving = points.filter((p) => p.moving && p.velocityMps > 0);
  if (moving.length < 60) return [];

  const sortedV = moving.map((p) => p.velocityMps).sort((a, b) => a - b);
  const median = percentileOf(sortedV, 50);
  const p75 = percentileOf(sortedV, 75);
  const hardThreshold = Math.max(p75, median * 1.12);
  if (hardThreshold <= median * 1.03) return []; // steady run, not enough pace variation to segment

  const smoothed = smoothVelocityByTime(moving, SMOOTH_WINDOW_SEC);

  interface RawSeg { startIdx: number; endIdx: number; hard: boolean }
  const segs: RawSeg[] = [];
  let curHard = smoothed[0] >= hardThreshold;
  let start = 0;
  for (let i = 1; i < smoothed.length; i++) {
    const isHard = smoothed[i] >= hardThreshold;
    if (isHard !== curHard) {
      segs.push({ startIdx: start, endIdx: i - 1, hard: curHard });
      start = i;
      curHard = isHard;
    }
  }
  segs.push({ startIdx: start, endIdx: smoothed.length - 1, hard: curHard });

  const hardSegs = segs.filter(
    (s) => s.hard && moving[s.endIdx].t - moving[s.startIdx].t >= MIN_REP_SECONDS
  );
  if (hardSegs.length === 0) return [];

  return hardSegs.map((seg, i) => {
    const segPoints = moving.slice(seg.startIdx, seg.endIdx + 1);
    const durationSec = Math.round(segPoints[segPoints.length - 1].t - segPoints[0].t);
    const distanceM = Math.round(segPoints[segPoints.length - 1].distanceM - segPoints[0].distanceM);
    const paceSecPerKm = distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : null;
    const hrSamples = segPoints.map((p) => p.hr).filter((h): h is number => h != null);
    const avgHr = hrSamples.length ? Math.round(average(hrSamples)) : null;

    // Recovery is only reported between two detected reps, not after the
    // last one — there's no "next rep" to define the recovery window against.
    let recovery: EffortSegment["recovery"] = null;
    const nextHardSeg = hardSegs[i + 1];
    if (nextHardSeg) {
      const recPoints = moving.slice(seg.endIdx + 1, nextHardSeg.startIdx);
      if (recPoints.length > 5) {
        const recDuration = Math.round(recPoints[recPoints.length - 1].t - recPoints[0].t);
        const recHrSamples = recPoints.map((p) => p.hr).filter((h): h is number => h != null);
        recovery = {
          durationSec: recDuration,
          avgHr: recHrSamples.length ? Math.round(average(recHrSamples)) : null,
        };
      }
    }

    return { rep: i + 1, durationSec, distanceM, paceSecPerKm, avgHr, recovery };
  });
}

// --- Effort vs. planned workout type ---

/**
 * Heuristic, not a hard rule — flags the two most common training mistakes:
 * running "easy" days too hard, and running "hard" days too easy.
 */
export function classifyEffortVsPlanned(
  workoutType: string | null,
  zones: ZonePct | null
): EffortVerdict | null {
  if (!zones || !workoutType) return null;
  const easyPct = zones.z1Pct + zones.z2Pct;
  const hardPct = zones.z4Pct + zones.z5Pct;

  if (["easy", "recovery", "long"].includes(workoutType)) {
    return hardPct > 20 ? "harder_than_planned" : "as_planned";
  }
  if (["tempo", "race_pace"].includes(workoutType)) {
    return easyPct > 60 ? "easier_than_planned" : "as_planned";
  }
  if (workoutType === "interval") {
    return zones.z5Pct < 5 && zones.z4Pct < 15 ? "easier_than_planned" : "as_planned";
  }
  return null;
}

/**
 * Fastest rolling efforts over classic benchmark distances, via two-pointer
 * sweep over the cumulative distance/time curve. Only distances the run
 * actually covers are returned. Pure pace — no HR needed.
 */
const BEST_EFFORT_TARGETS_M = [1000, 1609, 5000, 10000];

export function computeBestEfforts(points: StreamPoint[]): BestEffort[] {
  if (points.length < 10) return [];
  const totalM = points[points.length - 1].distanceM;
  const out: BestEffort[] = [];

  for (const target of BEST_EFFORT_TARGETS_M) {
    if (totalM < target) break;
    let best = Infinity;
    let j = 0;
    for (let i = 0; i < points.length; i++) {
      // advance j until at least `target` meters beyond point i
      while (j < points.length && points[j].distanceM - points[i].distanceM < target) j++;
      if (j >= points.length) break;
      const elapsed = points[j].t - points[i].t;
      if (elapsed > 0 && elapsed < best) best = elapsed;
    }
    if (Number.isFinite(best)) {
      out.push({
        distanceM: target,
        timeSec: Math.round(best),
        paceSecPerKm: Math.round(best / (target / 1000)),
      });
    }
  }
  return out;
}

// --- Orchestrator ---

export function analyzeStreams(
  points: StreamPoint[],
  maxHr: number | null,
  workoutType: string | null
): ActivityAnalysis {
  // HR-dependent metrics need both a max-HR reference and actual HR samples
  const hrSamples = points.filter((p) => p.hr != null).length;
  const hasHr = maxHr != null && hrSamples >= points.length * 0.5;
  const zones = hasHr ? computeZoneBreakdown(points, maxHr) : null;
  return {
    version: 2,
    maxHrUsed: maxHr ?? 0,
    zones,
    decouplingPct: hasHr ? computeCardiacDecoupling(points) : null,
    paceFade: computePaceFade(points),
    effortSegments: detectEffortSegments(points),
    effortVsPlanned: hasHr ? classifyEffortVsPlanned(workoutType, zones) : null,
    bestEfforts: computeBestEfforts(points),
    analyzedAt: new Date().toISOString(),
  };
}
