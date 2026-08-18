/**
 * Regression test for the week boundary on training totals.
 *   npx tsx scripts/dev-check-week-boundary.ts
 *
 * The bug: the opener widened its activity query by a day either side to
 * absorb timezone offsets and then never trimmed the pad back off, so LAST
 * Sunday's run counted towards THIS week. The coach announced "5km into an
 * 18km week" on a week that contained no running at all.
 *
 * The pure-logic sections encode the rule and need no database. The
 * end-to-end sections need local Postgres (Docker Desktop) and skip loudly
 * when it isn't up.
 *
 * Exits non-zero on any failure.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config();

import { weekTrainingFigures, weekStartWallFor, trimToWallWeek } from "@/lib/week-training";
import { wallDateString, addDaysWall } from "@/lib/schedule";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (d: string, c: boolean, got = "") => {
  if (c) { pass++; console.log(`  ✓ ${d}`); }
  else { fail++; console.log(`  ✗ FAIL: ${d}${got ? `  [${got}]` : ""}`); }
};

// Wed 26 Aug 2026. The week runs Mon 24 Aug – Sun 30 Aug.
const TODAY = "2026-08-26";

async function dbUp(): Promise<boolean> {
  try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
}

async function setup() {
  return prisma.user.create({
    data: {
      email: `wk-${process.pid}-${Math.round(performance.now() * 1000)}@test.local`,
      name: "Jan", passwordHash: "x",
      profile: { create: { timezone: "Europe/Berlin" } },
    },
  });
}

const run = (userId: string, date: string, km: number, name = "Run") =>
  prisma.activity.create({
    data: {
      userId, source: "strava", name, activityType: "Run",
      distanceKm: km, durationMin: km * 6,
      startDate: new Date(`${date}T09:00:00.000Z`),
      startDateLocal: new Date(`${date}T00:00:00.000Z`),
    },
  });

async function main() {
  console.log("\n[A] The trim, in isolation — this is the rule");
  {
    const mk = (d: string) => ({ startDateLocal: new Date(`${d}T00:00:00.000Z`), tag: d });
    const trimmed = trimToWallWeek(
      ["2026-08-23", "2026-08-24", "2026-08-27", "2026-08-30", "2026-08-31"].map(mk),
      weekStartWallFor(TODAY)
    ).map((x) => x.tag);
    check("last Sunday is dropped (the reported bug)", !trimmed.includes("2026-08-23"), trimmed.join());
    check("next Monday is dropped", !trimmed.includes("2026-08-31"));
    check("this week's Sunday is kept", trimmed.includes("2026-08-30"));
    check("this week's Monday is kept", trimmed.includes("2026-08-24"));
  }

  console.log("\n[B] Week starts");
  check("Wednesday resolves to its Monday", wallDateString(weekStartWallFor(TODAY)) === "2026-08-24", wallDateString(weekStartWallFor(TODAY)));
  check("Sunday belongs to the week that began 6 days earlier",
    wallDateString(weekStartWallFor("2026-08-30")) === "2026-08-24",
    wallDateString(weekStartWallFor("2026-08-30")));
  check("Monday is its own week start", wallDateString(weekStartWallFor("2026-08-24")) === "2026-08-24");

  if (!(await dbUp())) {
    console.log("\n  ⚠ Database unreachable — end-to-end sections skipped.");
    console.log("    Start Docker Desktop and re-run to exercise them.");
    console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed (pure logic only)\n${"=".repeat(60)}`);
    process.exitCode = fail > 0 ? 1 : 0;
    return;
  }

  console.log("\n[1] End to end: last Sunday's run must not count");
  const u = await setup();
  try {
    await run(u.id, "2026-08-23", 5, "Sunday long run (LAST week)");
    let f = await weekTrainingFigures(u.id, TODAY);
    check("week starts Monday 24 Aug", wallDateString(f.weekStartWall) === "2026-08-24", wallDateString(f.weekStartWall));
    check("last Sunday's 5km is NOT counted", f.runKm === 0, `${f.runKm}km`);
    check("...and is absent from the session list", f.activities.length === 0, String(f.activities.length));

    await run(u.id, "2026-08-24", 8, "Monday (this week)");
    f = await weekTrainingFigures(u.id, TODAY);
    check("Monday counts", f.runKm === 8, `${f.runKm}km`);

    await run(u.id, "2026-08-30", 12, "Sunday (THIS week)");
    f = await weekTrainingFigures(u.id, TODAY);
    check("this week's Sunday counts", f.runKm === 20, `${f.runKm}km`);

    await run(u.id, "2026-08-31", 6, "Monday (NEXT week)");
    f = await weekTrainingFigures(u.id, TODAY);
    check("next Monday does NOT count", f.runKm === 20, `${f.runKm}km`);
  } finally { await prisma.user.delete({ where: { id: u.id } }); }

  console.log("\n[2] Only running kilometres");
  const u2 = await setup();
  try {
    await run(u2.id, "2026-08-25", 10);
    await prisma.activity.create({ data: {
      userId: u2.id, source: "strava", name: "Zwift", activityType: "VirtualRide",
      distanceKm: 40, durationMin: 90,
      startDate: new Date("2026-08-25T09:00:00.000Z"), startDateLocal: new Date("2026-08-25T00:00:00.000Z"),
    }});
    const f = await weekTrainingFigures(u2.id, TODAY);
    check("bike km stay out of the running total", f.runKm === 10, `${f.runKm}km`);
    check("but the ride is still listed", f.activities.length === 2, String(f.activities.length));
  } finally { await prisma.user.delete({ where: { id: u2.id } }); }

  console.log("\n[3] Every day of the week is inside it");
  const u3 = await setup();
  try {
    const start = weekStartWallFor(TODAY);
    for (let i = 0; i < 7; i++) await run(u3.id, wallDateString(addDaysWall(start, i)), 1);
    const f = await weekTrainingFigures(u3.id, TODAY);
    check("all 7 days count, none dropped", f.runKm === 7, `${f.runKm}km`);
  } finally { await prisma.user.delete({ where: { id: u3.id } }); }

  console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; }).finally(() => prisma.$disconnect());
