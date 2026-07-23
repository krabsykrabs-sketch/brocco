/**
 * plan-health.mjs — one-time maintenance pass over active training plans.
 *
 * Two jobs, both SAFE:
 *   1. Backfill: give distance-less RUN workouts a target_distance_km, derived
 *      from the week's running target (or pace/duration, or a type default).
 *      This only fills empty fields — it never changes what a session is.
 *   2. Flag: report workouts that look like COMBINED sessions (two sports in
 *      one entry, e.g. "5km run + 60min ride"). These are NOT modified —
 *      splitting them correctly needs judgement, so leave that to Brocco.
 *
 * Dry-run by default (prints what it would do). Pass --apply to write the
 * backfills. Optional --user=email@example.com to limit to one account.
 *
 * Run it inside the app container (where @prisma/client and DATABASE_URL exist):
 *     node scripts/plan-health.mjs               # preview
 *     node scripts/plan-health.mjs --apply       # write the backfills
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const userArg = process.argv.find((a) => a.startsWith("--user="));
const onlyEmail = userArg ? userArg.slice("--user=".length) : null;

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// "4:15-4:30/km" or "5:30/km" -> minutes per km (first number of a range)
function paceMinPerKm(pace) {
  if (!pace) return null;
  const m = String(pace).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

const TYPE_DEFAULT_KM = { long: 16, tempo: 8, interval: 7, race_pace: 8, easy: 6, recovery: 5, race: 10 };

// Distance for a distance-less run, best source first.
function deriveKm(w, weekTargetKm, runsInWeek) {
  const withoutKm = runsInWeek.filter((r) => r.targetDistanceKm == null);
  if (weekTargetKm != null && withoutKm.length > 0) {
    const usedKm = runsInWeek
      .filter((r) => r.targetDistanceKm != null)
      .reduce((s, r) => s + Number(r.targetDistanceKm), 0);
    const remaining = Math.max(0, Number(weekTargetKm) - usedKm);
    if (remaining > 0) {
      // Long runs take a bigger slice of what's left; quality a touch more than easy.
      const weight = (t) => (t === "long" ? 2 : t === "tempo" || t === "interval" || t === "race_pace" ? 1.1 : 1);
      const totalW = withoutKm.reduce((s, r) => s + weight(r.workoutType), 0) || 1;
      return clamp(round1((remaining * weight(w.workoutType)) / totalW), 3, 42);
    }
  }
  const pace = paceMinPerKm(w.targetPace);
  if (w.targetDurationMin && pace) return clamp(round1(w.targetDurationMin / pace), 3, 42);
  return TYPE_DEFAULT_KM[w.workoutType] ?? 6;
}

const SPORT_WORDS = ["run", "ride", "bike", "cycl", "swim", "row", "ski", "hike", "walk"];
function looksCombined(w) {
  const t = (w.title || "").toLowerCase();
  const hasConnector = /(\+|&|\/|\bplus\b|\bthen\b|,| and )/.test(t);
  const sportCount = SPORT_WORDS.filter((s) => t.includes(s)).length;
  return hasConnector && sportCount >= 2;
}

async function main() {
  const plans = await prisma.plan.findMany({
    where: { status: "active", ...(onlyEmail ? { user: { email: onlyEmail } } : {}) },
    include: {
      user: { select: { email: true } },
      weeks: { select: { weekNumber: true, targetKm: true } },
      workouts: {
        select: { id: true, date: true, title: true, workoutType: true, activityType: true, weekNumber: true, targetDistanceKm: true, targetDurationMin: true, targetPace: true },
        orderBy: { date: "asc" },
      },
    },
    orderBy: { startDate: "asc" },
  });

  console.log(`Mode: ${APPLY ? "APPLY (writing backfills)" : "DRY RUN (no changes)"}`);
  console.log(`Active plans: ${plans.length}${onlyEmail ? ` (filtered to ${onlyEmail})` : ""}\n`);

  let totalBackfill = 0;
  let totalFlagged = 0;
  const writes = [];

  for (const plan of plans) {
    const targetByWeek = new Map(plan.weeks.map((w) => [w.weekNumber, w.targetKm != null ? Number(w.targetKm) : null]));
    const runsByWeek = new Map();
    for (const w of plan.workouts) {
      if (w.activityType === "run" && w.workoutType !== "rest") {
        if (!runsByWeek.has(w.weekNumber)) runsByWeek.set(w.weekNumber, []);
        runsByWeek.get(w.weekNumber).push(w);
      }
    }

    const backfills = [];
    const flagged = [];
    for (const w of plan.workouts) {
      if (looksCombined(w)) flagged.push(w);
      if (w.activityType === "run" && w.workoutType !== "rest" && w.targetDistanceKm == null) {
        const km = deriveKm(w, targetByWeek.get(w.weekNumber), runsByWeek.get(w.weekNumber) || []);
        backfills.push({ w, km });
        writes.push({ id: w.id, km });
      }
    }

    if (backfills.length === 0 && flagged.length === 0) continue;
    console.log(`── ${plan.user?.email || plan.userId} · "${plan.name}"`);
    for (const { w, km } of backfills) {
      console.log(`   backfill  ${w.date.toISOString().slice(0, 10)}  ${w.workoutType.padEnd(10)} "${(w.title || "").slice(0, 32)}"  → ${km} km`);
    }
    for (const w of flagged) {
      console.log(`   ⚠ COMBINED ${w.date.toISOString().slice(0, 10)}  "${(w.title || "").slice(0, 44)}"  (split via Brocco — not touched)`);
    }
    console.log("");
    totalBackfill += backfills.length;
    totalFlagged += flagged.length;
  }

  console.log(`Summary: ${totalBackfill} run(s) to backfill, ${totalFlagged} combined session(s) flagged.`);

  if (APPLY && writes.length > 0) {
    console.log(`\nApplying ${writes.length} backfill(s)…`);
    await prisma.$transaction(
      writes.map((x) => prisma.plannedWorkout.update({ where: { id: x.id }, data: { targetDistanceKm: x.km } }))
    );
    console.log("Done.");
  } else if (!APPLY && totalBackfill > 0) {
    console.log("\nRe-run with --apply to write the backfills. Combined sessions are only ever flagged.");
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
