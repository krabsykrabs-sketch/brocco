/**
 * Regression test for the "coach says it changed the plan but nothing changed"
 * class of bug.  Run with:  npx tsx scripts/dev-check-plan-tools.ts
 *
 * Rather than calling the live model, it replays the model behaviours seen in
 * real transcripts as scripted assistant turns, and runs them through the real
 * tool handlers, the real status grounding and the real history replay against
 * a throwaway user in the dev database (created and deleted per scenario).
 *
 * The question every scenario answers: can the user be told a change was made
 * when the database says otherwise?
 *
 * Exits non-zero on any failure.
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config();

import { handleToolCall } from "@/lib/tools";
import { groundStatusMarker, buildAssistantContent } from "@/app/api/chat/route";

const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

let pass = 0, fail = 0;
function check(desc: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`    ✓ ${desc}`); }
  else { fail++; console.log(`    ✗ FAIL: ${desc}${detail ? `  [${detail}]` : ""}`); }
}

async function setup() {
  const user = await prisma.user.create({
    data: {
      email: `e2e-${process.pid}-${Math.round(performance.now() * 1000)}@test.local`,
      name: "Jan", passwordHash: "x",
      profile: { create: { timezone: "Europe/Berlin" } },
    },
  });
  const plan = await prisma.plan.create({
    data: {
      userId: user.id, name: "Barcelona Marathon 2027", startDate: D("2026-08-03"),
      endDate: D("2027-03-14"), status: "active",
      weeks: { create: [
        { weekNumber: 1, startDate: D("2026-08-03"), detailLevel: "detailed", targetKm: 18 },
        { weekNumber: 2, startDate: D("2026-08-10"), detailLevel: "detailed", targetKm: 22 },
      ] },
    },
  });
  const mk = (date: string, title: string, type: string, km: number | null, pace: string | null) =>
    prisma.plannedWorkout.create({ data: {
      planId: plan.id, weekNumber: 1, date: D(date), title, workoutType: type as never,
      activityType: "run", targetDistanceKm: km, targetPace: pace, status: "planned" as never,
    } });
  const sat = await mk("2026-08-08", "Easy Run", "easy", 3, "6:00-6:30/km");
  const sun = await mk("2026-08-09", "Long Run", "long", 8, "6:00-6:30/km");
  return { user, plan, sat, sun };
}

/** One scripted assistant turn: run its tool calls, ground its status text. */
async function turn(userId: string, text: string, calls: Array<{ name: string; input: Record<string, unknown> }>) {
  const toolLog: string[] = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const results = [];
  for (const c of calls) {
    const r = await handleToolCall(c.name, c.input, userId, undefined);
    toolLog.push(r.success ? `${c.name} → OK: ${r.notification?.message ?? "applied"}` : `${c.name} → FAILED: ${r.error}`);
    if (r.notification) notifications.push({ type: r.notification.type, message: r.notification.message });
    results.push(r);
  }
  // Mirror the route: a notification is the mutation signal.
  const appliedMutation = notifications.length > 0;
  const grounded = groundStatusMarker(text, appliedMutation);
  const status = grounded.match(/\[STATUS:(question|done|info)\]/)?.[1] ?? "(none)";
  const replayed = buildAssistantContent(grounded, toolLog)
    .filter((b) => b.type === "text").map((b) => b.text).join("");
  return { grounded, status, notifications, results, toolLog, replayed };
}

const DONE_TEXT = "Done. Here's your updated weekend:\n\n[STATUS:done]Weekend adjusted — 5km today, 6km long run Sunday.[/STATUS]";

async function scenario1_noToolCall() {
  console.log("\n[1] Transcript #2 verbatim: coach describes changes and calls NO tool");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, []); // exactly what Rocco did
    check("status downgraded from :done to :info", t.status === "info", `got :${t.status}`);
    check("no green success strip is rendered", !t.grounded.includes("[STATUS:done]"));
    check("no tool notification badge", t.notifications.length === 0);
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("database correctly unchanged", String(after?.targetDistanceKm) === "8");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario2_hallucinatedId() {
  console.log("\n[2] Transcript #1: tool IS called, but with a stale/hallucinated workout id");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: "00000000-0000-0000-0000-000000000000", action: "update_targets", updates: { distance: 6 }, reason: "illness" }], summary: "Sunday long run trimmed to 6km" },
    }]);
    check("tool reports failure", t.results[0].success === false);
    check("no success badge emitted", t.notifications.length === 0);
    check("status downgraded to :info", t.status === "info", `got :${t.status}`);
    check("coach's next turn sees the FAILURE in history", t.replayed.includes("FAILED"));
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("database correctly unchanged", String(after?.targetDistanceKm) === "8");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario3_roccosExactCall() {
  console.log("\n[3] The call Rocco said it *should* have made (date inside update_targets)");
  const { user, sat } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sat.id, action: "update_targets", updates: { date: "2026-08-07", distance_km: 5, pace: "6:00-6:30/km" }, reason: "move to Fri" }], summary: "Moved Sat run to Fri" },
    }]);
    check("rejected rather than half-applied", t.results[0].success === false);
    check("error names the unsupported keys", /date/.test(String(t.results[0].error)));
    check("error points at the right action", /swap_rest_day|modify_plan/.test(String(t.results[0].error)));
    check("no success badge", t.notifications.length === 0);
    check("status downgraded to :info", t.status === "info", `got :${t.status}`);
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sat.id } });
    check("date NOT silently left behind", after?.date.toISOString().slice(0, 10) === "2026-08-08");
    check("distance NOT partially applied", String(after?.targetDistanceKm) === "3");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario4_correctCall() {
  console.log("\n[4] A correct adjust_plan — the success path must still work");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sun.id, action: "update_targets", updates: { distance: 6, pace: "6:15-6:45/km" }, reason: "post-illness" }], summary: "Sunday long run trimmed to 6km" },
    }]);
    check("tool succeeds", t.results[0].success === true, String(t.results[0].error));
    check("success badge emitted", t.notifications[0]?.type === "plan_adjusted");
    check("status :done is PRESERVED", t.status === "done", `got :${t.status}`);
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("database really changed to 6km", String(after?.targetDistanceKm) === "6", String(after?.targetDistanceKm));
    check("pace really changed", after?.targetPace === "6:15-6:45/km");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario5_partial() {
  console.log("\n[5] Partial: one valid change, one stale id");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [
        { workout_id: sun.id, action: "update_targets", updates: { distance: 6 }, reason: "ok" },
        { workout_id: "00000000-0000-0000-0000-000000000000", action: "update_targets", updates: { distance: 5 }, reason: "bad" },
      ], summary: "Two changes" },
    }]);
    check("badge marked partial (amber, not green)", t.notifications[0]?.type === "plan_adjusted_partial", t.notifications[0]?.type);
    check("badge says how many failed", /1 of 2/.test(t.notifications[0]?.message ?? ""));
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("the valid change did apply", String(after?.targetDistanceKm) === "6");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario6_dateMove() {
  console.log("\n[6] modify_plan moving a workout to another date/week");
  const { user, sat } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "modify_plan",
      input: { changes: [{ action: "update", workout_id: sat.id, updates: { date: "2026-08-12", distance: 5 }, reason: "move to next week" }], summary: "Moved run to Wed next week" },
    }]);
    check("tool succeeds", t.results[0].success === true, String(t.results[0].error));
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sat.id } });
    check("date actually moved", after?.date.toISOString().slice(0, 10) === "2026-08-12", after?.date.toISOString().slice(0, 10));
    check("weekNumber followed the move (1 -> 2)", after?.weekNumber === 2, String(after?.weekNumber));
    check("distance also applied", String(after?.targetDistanceKm) === "5");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario7_readOnlyDoesNotLicenseDone() {
  console.log("\n[7] A turn that only *queries* must not earn a green :done");
  const { user } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "query_data", input: { query_type: "activities", description: "recent runs" },
    }]);
    check("read-only tool does not preserve :done", t.status === "info", `got :${t.status}`);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario8_unknownKeyModifyPlan() {
  console.log("\n[8] modify_plan with an unsupported key must not half-apply");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "modify_plan",
      input: { changes: [{ action: "update", workout_id: sun.id, updates: { distance: 6, elevation_gain: 300 } }], summary: "x" },
    }]);
    check("rejected", t.results[0].success === false);
    check("names the bad key", /elevation_gain/.test(String(t.results[0].error)));
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("distance NOT partially applied", String(after?.targetDistanceKm) === "8");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario9_swapRestDay() {
  console.log("\n[9] swap_rest_day (was a no-op that reported success)");
  const { user, sat, sun } = await setup();
  try {
    const bad = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sat.id, action: "swap_rest_day", reason: "shift" }], summary: "shift" },
    }]);
    check("no date given -> reports failure (not silent success)", bad.results[0].success === false);
    check("status downgraded", bad.status === "info", `got :${bad.status}`);

    const ok = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sat.id, action: "swap_rest_day", updates: { swap_with_workout_id: sun.id }, reason: "swap" }], summary: "swapped" },
    }]);
    check("swap succeeds", ok.results[0].success === true, String(ok.results[0].error));
    const satAfter = await prisma.plannedWorkout.findUnique({ where: { id: sat.id } });
    const sunAfter = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("dates actually traded", satAfter?.date.toISOString().slice(0, 10) === "2026-08-09" && sunAfter?.date.toISOString().slice(0, 10) === "2026-08-08",
      `sat=${satAfter?.date.toISOString().slice(0, 10)} sun=${sunAfter?.date.toISOString().slice(0, 10)}`);
    check("no two workouts left on the same day", satAfter?.date.getTime() !== sunAfter?.date.getTime());
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario10_markCovered() {
  console.log("\n[10] mark_covered still works");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sun.id, action: "mark_covered", reason: "did it" }], summary: "marked done" },
    }]);
    check("succeeds", t.results[0].success === true, String(t.results[0].error));
    check("status :done preserved", t.status === "done");
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("status really set to completed", after?.status === "completed", String(after?.status));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}


async function scenario11_mixedIntent() {
  console.log("\n[11] Mixed intent: one real tool + a fabricated plan claim (residual limit)");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id,
      "Logged the knee. I've also moved your long run to Saturday.\n\n[STATUS:done]Knee logged, long run moved[/STATUS]",
      [{ name: "log_health", input: { entry_type: "injury", description: "sore knee", body_part: "knee", severity: "minor" } }]);
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("the plan claim is indeed false (nothing moved)", after?.date.toISOString().slice(0, 10) === "2026-08-09");
    console.log(`    [i] status is :${t.status} — a real write (log_health) licenses the whole message.`);
    console.log("    [i] KNOWN RESIDUAL: grounding is per-turn, not per-claim.");
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario12_saveProfileNoWrite() {
  console.log("\n[12] save_profile with no recognised field must not report success");
  const { user } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "save_profile", input: { training_days: ["mon", "wed", "fri"] },
    }]);
    check("reports failure", t.results[0].success === false);
    check("no 'Profile updated' badge", t.notifications.length === 0);
    check("status downgraded to :info", t.status === "info", `got :${t.status}`);
    const real = await turn(user.id, DONE_TEXT, [{ name: "save_profile", input: { years_running: 5 } }]);
    check("a real save still works", real.results[0].success === true);
    const p = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    check("value really written", p?.yearsRunning === 5, String(p?.yearsRunning));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario13_addWorkoutVisible() {
  console.log("\n[13] modify_plan add: workout must land in a week the Plan tab renders");
  const { user, plan } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "modify_plan",
      input: { changes: [{ action: "add", date: "2026-08-11", updates: { title: "Z2 Ride", workout_type: "cross_training", activity_type: "cycle", duration: 60 } }], summary: "Added Tuesday ride" },
    }]);
    check("succeeds", t.results[0].success === true, String(t.results[0].error));
    const created = await prisma.plannedWorkout.findFirst({ where: { planId: plan.id, title: "Z2 Ride" } });
    check("weekNumber resolved to the real week (2), not 0", created?.weekNumber === 2, String(created?.weekNumber));
    check("activity_type honoured (cycle, not run)", created?.activityType === "cycle", String(created?.activityType));
    check("duration applied", created?.targetDurationMin === 60);
    const weeks = await prisma.planWeek.findMany({ where: { planId: plan.id } });
    check("its week exists on the plan, so the Plan tab shows it",
      weeks.some((w) => w.weekNumber === created?.weekNumber));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario14_addRejects() {
  console.log("\n[14] add rejects unknown keys and out-of-plan dates");
  const { user } = await setup();
  try {
    const bad = await turn(user.id, DONE_TEXT, [{
      name: "modify_plan",
      input: { changes: [{ action: "add", date: "2026-08-11", updates: { title: "X", target_distance_km: 5 } }], summary: "x" },
    }]);
    check("unknown key rejected (generate_plan-style naming)", bad.results[0].success === false);
    check("names the bad key", /target_distance_km/.test(String(bad.results[0].error)));

    const far = await turn(user.id, DONE_TEXT, [{
      name: "modify_plan",
      input: { changes: [{ action: "add", date: "2027-01-05", updates: { title: "Y" } }], summary: "y" },
    }]);
    check("date outside every plan week rejected", far.results[0].success === false);
    check("error explains it would be invisible", /would not show up/.test(String(far.results[0].error)));
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function scenario15_swapAcrossWeeks() {
  console.log("\n[15] swap_rest_day across a week boundary carries weekNumber");
  const { user, sun } = await setup();
  try {
    const t = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sun.id, action: "swap_rest_day", updates: { date: "2026-08-12" }, reason: "move" }], summary: "moved" },
    }]);
    check("succeeds", t.results[0].success === true, String(t.results[0].error));
    const after = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });
    check("date moved", after?.date.toISOString().slice(0, 10) === "2026-08-12");
    check("weekNumber followed (1 -> 2)", after?.weekNumber === 2, String(after?.weekNumber));
    check("status marked modified", after?.status === "modified", String(after?.status));

    const far = await turn(user.id, DONE_TEXT, [{
      name: "adjust_plan",
      input: { adjustments: [{ workout_id: sun.id, action: "swap_rest_day", updates: { date: "2027-02-01" }, reason: "move" }], summary: "moved" },
    }]);
    check("move outside the plan's weeks rejected", far.results[0].success === false);
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function main() {
  await scenario1_noToolCall();
  await scenario2_hallucinatedId();
  await scenario3_roccosExactCall();
  await scenario4_correctCall();
  await scenario5_partial();
  await scenario6_dateMove();
  await scenario7_readOnlyDoesNotLicenseDone();
  await scenario8_unknownKeyModifyPlan();
  await scenario9_swapRestDay();
  await scenario10_markCovered();
  await scenario11_mixedIntent();
  await scenario12_saveProfileNoWrite();
  await scenario13_addWorkoutVisible();
  await scenario14_addRejects();
  await scenario15_swapAcrossWeeks();

  console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; }).finally(() => prisma.$disconnect());
