import { prisma } from "@/lib/db";
import { encryptToken, decryptToken } from "@/lib/strava";
import { wallDateString, addDaysWall, parseWall, todayInTimezone } from "@/lib/schedule";
import type { PlannedWorkout } from "@prisma/client";

/**
 * Watch sync via intervals.icu.
 *
 * intervals.icu is the bridge: planned workouts pushed onto a user's
 * intervals.icu calendar are forwarded by intervals.icu to the user's
 * connected watch platform (COROS Training Hub, Garmin Connect, Wahoo,
 * Polar, Suunto) with full interval structure. Each brocc user connects
 * their own free intervals.icu account (Settings → Watch sync).
 *
 * API: basic auth, username literally "API_KEY", password = personal key
 * from intervals.icu Settings. Events: POST/PUT/DELETE
 * /api/v1/athlete/{id}/events. We reconcile a rolling window and mark our
 * events with an external_id of "brocc-<plannedWorkoutId>" so user-created
 * events are never touched.
 */

const BASE = "https://intervals.icu/api/v1";
const SYNC_WINDOW_DAYS = 14;

// One nesting level: a step, or a repeat block of steps
export interface WorkoutStep {
  kind: "warmup" | "steady" | "work" | "recovery" | "cooldown";
  label?: string;
  distanceKm?: number;
  durationMin?: number;
  pace?: string; // "4:25-4:35/km" or "4:30/km"
}
export interface RepeatBlock {
  kind: "repeat";
  times: number;
  steps: WorkoutStep[];
}
export type StepsJson = Array<WorkoutStep | RepeatBlock>;

/**
 * Steps are authored by the coach against a snake_case tool schema
 * (`distance_km`, `duration_min`) and stored verbatim, but everything here
 * reads camelCase. Unnormalised, `s.distanceKm` was always undefined and every
 * interval step silently fell back to "5 minutes" — so a 6×800m session
 * reached the watch as six 5-minute blocks. Accept either spelling on read
 * rather than migrating stored rows.
 */
function normaliseStep<T extends Record<string, unknown>>(raw: T): T {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    distanceKm: r.distanceKm ?? r.distance_km,
    durationMin: r.durationMin ?? r.duration_min,
  } as unknown as T;
}

/** Normalises a whole steps array, including the steps inside repeat blocks. */
export function normaliseSteps(steps: StepsJson): StepsJson {
  return steps.map((s) => {
    const step = normaliseStep(s as unknown as Record<string, unknown>);
    if ((step as unknown as RepeatBlock).kind === "repeat") {
      const block = step as unknown as RepeatBlock;
      return { ...block, steps: (block.steps || []).map((inner) => normaliseStep(inner as unknown as Record<string, unknown>)) } as unknown as RepeatBlock;
    }
    return step as unknown as WorkoutStep;
  });
}

function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
}

async function api(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // DELETE returns empty body
  }
  return { ok: res.ok, status: res.status, data };
}

/** Verify credentials by fetching the athlete profile. */
export async function testConnection(
  athleteId: string,
  apiKey: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  try {
    const res = await api(apiKey, "GET", `/athlete/${athleteId}`);
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 401 || res.status === 403
            ? "intervals.icu rejected the API key — copy it again from intervals.icu Settings → Developer"
            : `intervals.icu returned ${res.status} — check the athlete ID (the number in your intervals.icu profile URL, e.g. i1234567 or just 1234567)`,
      };
    }
    const name = (res.data as { name?: string } | null)?.name;
    return { ok: true, name };
  } catch {
    return { ok: false, error: "Couldn't reach intervals.icu — try again" };
  }
}

// --- Workout DSL rendering ---

function stepLine(s: WorkoutStep): string {
  const amount = s.distanceKm
    ? s.distanceKm >= 1
      ? `${Number(s.distanceKm.toFixed(2))}km`
      : `${Math.round(s.distanceKm * 1000)}m`
    : `${Math.max(1, Math.round(s.durationMin || 5))}m`;
  const pace = s.pace ? ` ${s.pace.replace(/\s*pace$/i, "")} pace` : "";
  const label = s.label ? `${s.label} ` : "";
  return `- ${label}${amount}${pace}`;
}

/**
 * Render a planned workout to the intervals.icu workout text syntax.
 * With structured steps: full interval structure (warmup / Nx(work,
 * recovery) / cooldown). Without: a single steady step from the workout's
 * distance/duration/pace targets — still gives the watch a target to guide.
 */
export function renderWorkoutDsl(w: Pick<PlannedWorkout, "steps" | "targetDistanceKm" | "targetPace" | "targetDurationMin" | "description">): string {
  const raw = (w.steps as StepsJson | null) || null;
  const steps = raw && Array.isArray(raw) ? normaliseSteps(raw) : null;

  if (steps && steps.length > 0) {
    const parts: string[] = [];
    for (const s of steps) {
      if (s.kind === "repeat") {
        parts.push(`\n${s.times}x`);
        for (const inner of s.steps) parts.push(stepLine(inner));
      } else if (s.kind === "warmup" || s.kind === "cooldown") {
        parts.push(`\n${s.kind === "warmup" ? "Warmup" : "Cooldown"}`);
        parts.push(stepLine(s));
      } else {
        parts.push(stepLine(s));
      }
    }
    return parts.join("\n").trim();
  }

  // Fallback: single steady effort from the top-level targets
  const dist = w.targetDistanceKm ? Number(w.targetDistanceKm) : null;
  const dur = w.targetDurationMin || null;
  const pace = w.targetPace ? ` ${w.targetPace.replace(/\s*pace$/i, "")} pace` : "";
  if (dist) return `- ${dist}km${pace}`;
  if (dur) return `- ${dur}m${pace}`;
  return "";
}

const SYNCABLE_ACTIVITY: Record<string, string> = {
  run: "Run",
  cycle: "Ride",
};

interface IcuEvent {
  id: number;
  external_id?: string | null;
  start_date_local?: string;
  name?: string;
  description?: string;
}

/**
 * Push the user's upcoming planned workouts (today .. +14d) to their
 * intervals.icu calendar. Reconciles: creates missing, updates changed,
 * deletes brocc-tagged events whose workout no longer exists (plan
 * adjustments, week promotion). Never throws — watch sync must not break
 * plan operations; returns a summary for logging/UI.
 */
export interface SyncResult {
  synced: boolean;
  created?: number;
  updated?: number;
  deleted?: number;
  error?: string;
  // Diagnostics — explain what a "0 new / 0 updated" result actually means.
  hasActivePlan?: boolean;
  windowWorkouts?: number;   // non-rest, non-done plan workouts in the 14d window
  desiredCount?: number;     // of those, how many are syncable (run/ride with a target)
  skippedType?: number;      // skipped: activity type the watch doesn't take (strength/swim/…)
  skippedNoTarget?: number;  // skipped: no distance/duration/steps to guide with
  onCalendar?: number;       // brocc-tagged events already on the intervals.icu calendar
}

export async function syncWorkoutsToIntervals(
  userId: string
): Promise<SyncResult> {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { intervalsAthleteId: true, intervalsApiKey: true, timezone: true },
    });
    if (!profile?.intervalsAthleteId || !profile.intervalsApiKey) {
      return { synced: false, error: "not_connected" };
    }
    const athleteId = profile.intervalsAthleteId;
    const apiKey = decryptToken(profile.intervalsApiKey);

    const activePlan = await prisma.plan.findFirst({
      where: { userId, status: "active" },
      select: { id: true },
    });

    const today = todayInTimezone(profile.timezone);
    const windowEnd = wallDateString(addDaysWall(parseWall(today), SYNC_WINDOW_DAYS));

    const workouts = await prisma.plannedWorkout.findMany({
      where: {
        plan: { userId, status: "active" },
        date: { gte: parseWall(today), lte: parseWall(windowEnd) },
        workoutType: { not: "rest" },
        status: { notIn: ["completed", "skipped"] },
      },
      orderBy: { date: "asc" },
    });

    // Desired state, keyed by external_id
    const desired = new Map<
      string,
      { start_date_local: string; category: "WORKOUT"; type: string; name: string; description: string; external_id: string }
    >();
    let skippedType = 0;
    let skippedNoTarget = 0;
    for (const w of workouts) {
      const type = SYNCABLE_ACTIVITY[w.activityType];
      if (!type) { skippedType++; continue; } // strength/swim/etc. live in the app, not the watch
      const dsl = renderWorkoutDsl(w);
      if (!dsl) { skippedNoTarget++; continue; } // nothing measurable to guide
      const extId = `brocc-${w.id}`;
      desired.set(extId, {
        start_date_local: `${wallDateString(w.date)}T00:00:00`,
        category: "WORKOUT",
        type,
        name: w.title,
        description: dsl,
        external_id: extId,
      });
    }

    // Current state on the intervals.icu calendar (only our events)
    const listRes = await api(
      apiKey,
      "GET",
      `/athlete/${athleteId}/events?oldest=${today}&newest=${windowEnd}&category=WORKOUT`
    );
    if (!listRes.ok) {
      return { synced: false, error: `list failed (${listRes.status})` };
    }
    const existing = ((listRes.data as IcuEvent[]) || []).filter(
      (e) => typeof e.external_id === "string" && e.external_id.startsWith("brocc-")
    );

    const diag = {
      hasActivePlan: !!activePlan,
      windowWorkouts: workouts.length,
      desiredCount: desired.size,
      skippedType,
      skippedNoTarget,
      onCalendar: existing.length,
    };

    let created = 0;
    let updated = 0;
    let deleted = 0;

    for (const ev of existing) {
      const want = desired.get(ev.external_id!);
      if (!want) {
        const del = await api(apiKey, "DELETE", `/athlete/${athleteId}/events/${ev.id}`);
        if (del.ok) deleted++;
      } else if (
        want.name !== ev.name ||
        want.description !== (ev.description || "") ||
        !ev.start_date_local?.startsWith(want.start_date_local.slice(0, 10))
      ) {
        const put = await api(apiKey, "PUT", `/athlete/${athleteId}/events/${ev.id}`, want);
        if (put.ok) updated++;
        desired.delete(ev.external_id!);
      } else {
        desired.delete(ev.external_id!); // unchanged
      }
    }

    for (const payload of desired.values()) {
      const post = await api(apiKey, "POST", `/athlete/${athleteId}/events`, payload);
      if (post.ok) created++;
    }

    return { synced: true, created, updated, deleted, ...diag };
  } catch (err) {
    console.error("[intervals-icu] sync failed:", err);
    return { synced: false, error: "sync_failed" };
  }
}

/** Save credentials (encrypted) after a successful connection test. */
export async function saveConnection(userId: string, athleteId: string, apiKey: string): Promise<void> {
  await prisma.userProfile.update({
    where: { userId },
    data: {
      intervalsAthleteId: athleteId,
      intervalsApiKey: encryptToken(apiKey),
    },
  });
}

export async function disconnect(userId: string): Promise<void> {
  await prisma.userProfile.update({
    where: { userId },
    data: { intervalsAthleteId: null, intervalsApiKey: null },
  });
}

/** Fire-and-forget wrapper for plan-mutation call sites. */
export function syncWorkoutsInBackground(userId: string): void {
  syncWorkoutsToIntervals(userId)
    .then((r) => {
      if (r.synced) {
        console.log(
          `[intervals-icu] synced user=${userId}: +${r.created} ~${r.updated} -${r.deleted} ` +
            `(window=${r.windowWorkouts} syncable=${r.desiredCount} skippedType=${r.skippedType} ` +
            `skippedNoTarget=${r.skippedNoTarget} onCalendar=${r.onCalendar})`
        );
      } else if (r.error !== "not_connected") {
        console.warn(`[intervals-icu] sync skipped user=${userId}: ${r.error}`);
      }
    })
    .catch(() => {});
}
