/**
 * One-off: re-analyze recent runs so laps, best efforts (analysis v2), and
 * power/cadence exist for history that predates these features.
 *
 * Usage (from repo root, WSL):
 *   npx tsx scripts/backfill-analysis.ts <email> [days=120]
 *
 * Rate-limit friendly: 2 Strava calls per run (streams + laps) with a 1.5s
 * gap — 60 runs ≈ 120 calls over ~3 min, well inside 100 req/15min.
 */
import { prisma } from "../src/lib/db";
import { analyzeActivity, isEligibleForAnalysis } from "../src/lib/activity-analysis";
import { RUN_TYPES } from "../src/lib/activity-types";

const email = process.argv[2];
const days = Number(process.argv[3] || 120);

async function main() {
  if (!email) throw new Error("Usage: npx tsx scripts/backfill-analysis.ts <email> [days]");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`No user for ${email}`);

  const since = new Date(Date.now() - days * 86400000);
  const runs = await prisma.activity.findMany({
    where: {
      userId: user.id,
      source: "strava",
      activityType: { in: RUN_TYPES },
      startDateLocal: { gte: since },
    },
    orderBy: { startDateLocal: "desc" },
    select: { id: true, name: true, startDateLocal: true, activityType: true, avgHeartRate: true, durationMin: true, activityAnalysis: true, laps: true },
  });

  const todo = runs.filter((r) => {
    if (!isEligibleForAnalysis(r)) return false;
    const version = (r.activityAnalysis as { version?: number } | null)?.version ?? 0;
    return version < 2 || !r.laps;
  });

  console.log(`${runs.length} runs in last ${days}d, ${todo.length} to (re-)analyze`);
  let done = 0;
  for (const r of todo) {
    try {
      const result = await analyzeActivity(user.id, r.id);
      done++;
      console.log(`[${done}/${todo.length}] ${r.startDateLocal.toISOString().slice(0, 10)} "${r.name}" — ${result ? "ok" : "no streams"}`);
    } catch (err) {
      console.error(`  failed: ${r.name}:`, err instanceof Error ? err.message : err);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  console.log("backfill complete");
  await prisma.$disconnect();
}

main();
