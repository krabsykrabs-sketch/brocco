/**
 * Regression test for flexible weekly goals.
 *   npx tsx scripts/dev-check-weekly-goals.ts
 *
 * Exercises the real reconciler and the real coach tool against a throwaway
 * user in the dev database. The question behind every case: does the count the
 * athlete sees match what they actually did?
 *
 * Exits non-zero on any failure.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config();

import { reconcileWeek, resolveCredit, weekStartOf, renderWeeklyGoalsLine } from "@/lib/weekly-goals";
import { handleToolCall } from "@/lib/tools";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (d: string, c: boolean, got = "") => {
  if (c) { pass++; console.log(`    ✓ ${d}`); }
  else { fail++; console.log(`    ✗ FAIL: ${d}${got ? `  [${got}]` : ""}`); }
};

const WEEK = weekStartOf("2026-08-03"); // Mon 3 Aug 2026

async function setup() {
  const user = await prisma.user.create({
    data: {
      email: `goals-${process.pid}-${Math.round(performance.now() * 1000)}@test.local`,
      name: "Jan", passwordHash: "x",
      profile: { create: { timezone: "Europe/Berlin" } },
    },
  });
  return user;
}

const act = (userId: string, type: string, date: string, name = type) =>
  prisma.activity.create({
    data: {
      userId, source: "strava", name, activityType: type,
      durationMin: 45,
      startDate: new Date(`${date}T09:00:00.000Z`),
      startDateLocal: new Date(`${date}T00:00:00.000Z`),
    },
  });

const goal = (userId: string, label: string, category: string, target: number) =>
  prisma.weeklyGoal.create({
    data: { userId, weekStart: WEEK, label, category: category as never, targetCount: target },
  });

async function s1_autoCount() {
  console.log("\n[1] Sessions count themselves — nothing to tick");
  const user = await setup();
  try {
    await goal(user.id, "Ankle strength", "strength", 4);
    let p = await reconcileWeek(user.id, WEEK);
    check("starts at 0 of 4", p[0].done === 0 && p[0].target === 4, `${p[0].done}/${p[0].target}`);
    check("not met", !p[0].met);

    await act(user.id, "WeightTraining", "2026-08-04");
    p = await reconcileWeek(user.id, WEEK);
    check("a gym session credits automatically", p[0].done === 1, String(p[0].done));

    await act(user.id, "WeightTraining", "2026-08-05");
    await act(user.id, "Workout", "2026-08-06");
    await act(user.id, "Crossfit", "2026-08-07");
    p = await reconcileWeek(user.id, WEEK);
    check("reaches 4 of 4 and is met", p[0].done === 4 && p[0].met, `${p[0].done}/4`);

    await act(user.id, "WeightTraining", "2026-08-08");
    p = await reconcileWeek(user.id, WEEK);
    check("overachievement shows 5, not capped", p[0].done === 5, String(p[0].done));

    check("no ambiguity with a single goal", p[0].provisional.length === 0);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s2_wrongTypesAndWeeks() {
  console.log("\n[2] Only matching sessions, only this week");
  const user = await setup();
  try {
    await goal(user.id, "Ankle strength", "strength", 3);
    await act(user.id, "Run", "2026-08-04");            // wrong type
    await act(user.id, "Ride", "2026-08-05");           // wrong type
    await act(user.id, "WeightTraining", "2026-07-30"); // previous week
    await act(user.id, "WeightTraining", "2026-08-11"); // next week
    const p = await reconcileWeek(user.id, WEEK);
    check("a run does not count towards strength", p[0].done === 0, String(p[0].done));

    await act(user.id, "WeightTraining", "2026-08-03"); // Monday, first day
    await act(user.id, "WeightTraining", "2026-08-09"); // Sunday, last day
    const p2 = await reconcileWeek(user.id, WEEK);
    check("both week boundary days count", p2[0].done === 2, String(p2[0].done));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s3_ambiguity() {
  console.log("\n[3] Two goals could claim the same session");
  const user = await setup();
  try {
    const strength = await goal(user.id, "Gym", "strength", 2);
    await goal(user.id, "Mobility", "mobility", 2);
    // "Workout" is Strava's catch-all and matches both categories.
    const a = await act(user.id, "Workout", "2026-08-04", "Evening session");

    const p = await reconcileWeek(user.id, WEEK);
    const total = p.reduce((n, g) => n + g.done, 0);
    check("counted immediately, not withheld pending a question", total === 1, String(total));
    check("credited to exactly one goal", p.filter((g) => g.done === 1).length === 1);
    const flagged = p.find((g) => g.provisional.length > 0);
    check("flagged provisional for the coach to confirm", !!flagged);
    check("provisional names the session", flagged?.provisional[0].name === "Evening session");

    // Coach confirms it belonged to strength
    const r = await resolveCredit(user.id, a.id, strength.id);
    check("resolve succeeds", r.ok, r.error);
    const p2 = await reconcileWeek(user.id, WEEK);
    const s = p2.find((g) => g.label === "Gym")!;
    const m = p2.find((g) => g.label === "Mobility")!;
    check("credit sits on the confirmed goal", s.done === 1 && m.done === 0, `gym=${s.done} mob=${m.done}`);
    check("no longer provisional", s.provisional.length === 0);

    const p3 = await reconcileWeek(user.id, WEEK);
    check("stable across repeated reconciles", p3.find((g) => g.label === "Gym")!.done === 1);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s4_dismissSticks() {
  console.log("\n[4] A rejected session stays rejected");
  const user = await setup();
  try {
    await goal(user.id, "Ankle strength", "strength", 3);
    const a = await act(user.id, "WeightTraining", "2026-08-04");
    check("credited first", (await reconcileWeek(user.id, WEEK))[0].done === 1);

    // "That was upper body, it doesn't count."
    const r = await resolveCredit(user.id, a.id, null);
    check("dismiss succeeds", r.ok, r.error);
    check("count drops back", (await reconcileWeek(user.id, WEEK))[0].done === 0);
    check("reconciler does not re-credit it", (await reconcileWeek(user.id, WEEK))[0].done === 0);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s5_manualOnly() {
  console.log("\n[5] Categories nothing can evidence");
  const user = await setup();
  try {
    await goal(user.id, "Protein target", "nutrition", 7);
    await act(user.id, "WeightTraining", "2026-08-04");
    const p = await reconcileWeek(user.id, WEEK);
    check("a gym session does not satisfy a nutrition goal", p[0].done === 0, String(p[0].done));
    check("flagged as not auto-tracked so the coach asks", p[0].autoTracked === false);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s6_coachTool() {
  console.log("\n[6] The coach tool — and its failure paths");
  const user = await setup();
  try {
    const call = (input: Record<string, unknown>) =>
      handleToolCall("manage_weekly_goals", input, user.id, undefined);

    const set = await call({ action: "set", label: "Ankle strength", category: "strength", target_count: 4, week_start: "2026-08-03" });
    check("set succeeds", set.success, String(set.error));
    check("emits a notification", !!set.notification);
    const saved = await prisma.weeklyGoal.findFirst({ where: { userId: user.id } });
    check("really written to the database", saved?.targetCount === 4, String(saved?.targetCount));

    const bad = await call({ action: "set", label: "X", category: "cardio", target_count: 3, week_start: "2026-08-03" });
    check("rejects an invalid category", !bad.success);
    check("no notification on failure", !bad.notification);

    const noTarget = await call({ action: "set", label: "Y", category: "strength", week_start: "2026-08-03" });
    check("rejects a missing target_count", !noTarget.success);

    const upd = await call({ action: "set", label: "Ankle strength", category: "strength", target_count: 3, week_start: "2026-08-03" });
    check("set is an upsert, not a duplicate", upd.success);
    check("only one goal exists", (await prisma.weeklyGoal.count({ where: { userId: user.id } })) === 1);

    const list = await call({ action: "list", week_start: "2026-08-03" });
    check("list succeeds", list.success);
    check("list emits NO notification (read-only, cannot license a done claim)", !list.notification);

    const rmMissing = await call({ action: "remove", label: "Nope", week_start: "2026-08-03" });
    check("removing a goal that isn't there reports failure", !rmMissing.success);
    check("...and emits no notification", !rmMissing.notification);

    const rm = await call({ action: "remove", label: "Ankle strength", week_start: "2026-08-03" });
    check("remove succeeds", rm.success);
    check("really deleted", (await prisma.weeklyGoal.count({ where: { userId: user.id } })) === 0);

    const badAction = await call({ action: "frobnicate" });
    check("unknown action reports failure", !badAction.success);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function s7_isolation() {
  console.log("\n[7] One athlete's sessions never credit another's goals");
  const a = await setup();
  const b = await setup();
  try {
    await goal(a.id, "Gym", "strength", 3);
    await act(b.id, "WeightTraining", "2026-08-04");
    const p = await reconcileWeek(a.id, WEEK);
    check("another user's activity does not count", p[0].done === 0, String(p[0].done));

    const bGoal = await goal(b.id, "Gym", "strength", 3);
    const stolen = await resolveCredit(a.id, (await prisma.activity.findFirst({ where: { userId: b.id } }))!.id, bGoal.id);
    check("cannot resolve another user's activity", !stolen.ok);
  } finally {
    await prisma.user.delete({ where: { id: a.id } });
    await prisma.user.delete({ where: { id: b.id } });
  }
}

async function s8_followUpChannel() {
  console.log("\n[8] The opener/briefing line — the chosen follow-up channel");
  const user = await setup();
  try {
    const empty = await renderWeeklyGoalsLine(user.id, "Europe/Berlin");
    check("silent when no goals are set", empty === "", JSON.stringify(empty));

    // Goals are keyed to the CURRENT week here — this renderer always reports
    // the live week, which is the whole point of it.
    const { currentWeekStart } = await import("@/lib/weekly-goals");
    const week = currentWeekStart("Europe/Berlin");
    await prisma.weeklyGoal.create({
      data: { userId: user.id, weekStart: week, label: "Ankle strength", category: "strength" as never, targetCount: 4 },
    });
    const line = await renderWeeklyGoalsLine(user.id, "Europe/Berlin");
    check("names the goal and its progress", /Ankle strength 0\/4/.test(line), line.slice(0, 90));
    check("states days remaining so it can judge urgency", /day\(s\) left/.test(line));
    check("tells the coach not to nag", /never nag/.test(line));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function main() {
  await s1_autoCount();
  await s2_wrongTypesAndWeeks();
  await s3_ambiguity();
  await s4_dismissSticks();
  await s5_manualOnly();
  await s6_coachTool();
  await s7_isolation();
  await s8_followUpChannel();
  console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; }).finally(() => prisma.$disconnect());
