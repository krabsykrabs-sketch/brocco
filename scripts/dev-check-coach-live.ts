/**
 * Live-model check: does the coach actually CALL the tool, or does it just say
 * it did?   npx tsx scripts/dev-check-coach-live.ts [trials]
 *
 * This is the one thing the deterministic suites cannot answer. It drives the
 * real Anthropic model through the real system prompt and real tool
 * definitions, executes whatever tools it calls against a throwaway user in the
 * dev database, and then asks the only question that matters: after the
 * conversation, had the plan actually changed?
 *
 * The scenario is taken verbatim from the transcript that started all of this.
 * Costs real tokens — run deliberately, not in CI.
 */
import { PrismaClient } from "@prisma/client";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config();

import { buildCoachContext, buildSystemPrompt } from "@/lib/coach-context";
import { toolsForFeatures, handleToolCall } from "@/lib/tools";
import { resolveFeatures } from "@/lib/features";
import { groundStatusMarker, buildAssistantContent } from "@/app/api/chat/route";
import { COACH_MODEL } from "@/lib/models";

const prisma = new PrismaClient();
const anthropic = new Anthropic();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

const JAN_MSG =
  "I was ill the first three days of this week. Yesterday I did some cycling and today I want to do an easy 5k. " +
  "Tomorrow I want to go cycling and on Sunday I can do a long run. Please update the plan.";

async function setup(tag: string) {
  const user = await prisma.user.create({
    data: {
      email: `live-${tag}-${process.pid}-${Math.round(performance.now() * 1000)}@test.local`,
      name: "Jan", passwordHash: "x",
      profile: { create: { timezone: "Europe/Berlin", weeklyKmBaseline: 25, yearsRunning: 3 } },
    },
  });
  const plan = await prisma.plan.create({
    data: {
      userId: user.id, name: "Barcelona Marathon 2027", goal: "sub 4:00",
      startDate: D("2026-08-03"), endDate: D("2027-03-14"), raceDate: D("2027-03-14"),
      status: "active",
      weeks: { create: [
        { weekNumber: 1, startDate: D("2026-08-03"), detailLevel: "detailed", targetKm: 18, targetSessions: 5 },
        { weekNumber: 2, startDate: D("2026-08-10"), detailLevel: "detailed", targetKm: 22, targetSessions: 5 },
      ] },
    },
  });
  const mk = (date: string, title: string, type: string, km: number | null, pace: string | null) =>
    prisma.plannedWorkout.create({ data: {
      planId: plan.id, weekNumber: 1, date: D(date), title, workoutType: type as never,
      activityType: "run", targetDistanceKm: km, targetPace: pace, status: "planned" as never,
    } });

  await mk("2026-08-03", "Strength & Conditioning", "strength", null, null);
  await mk("2026-08-04", "Easy Run", "easy", 4, "6:00-6:30/km");
  await mk("2026-08-05", "Easy Run with Strides", "easy", 5, "6:00-6:30/km");
  const sat = await mk("2026-08-08", "Easy Run", "easy", 3, "6:00-6:30/km");
  const sun = await mk("2026-08-09", "Long Run", "long", 8, "6:00-6:30/km");
  return { user, plan, sat, sun };
}

/** Faithful replica of the chat route's tool loop. */
async function runTurn(userId: string, messages: Anthropic.MessageParam[]) {
  const context = await buildCoachContext(userId);
  const { staticPart, dynamicPart } = await buildSystemPrompt(userId, "Jan", context, "chat");
  const systemPrompt = `${staticPart}\n\n${dynamicPart}`;
  const flags = await prisma.userProfile.findUnique({ where: { userId }, select: { features: true } });
  const tools = toolsForFeatures(resolveFeatures(flags?.features));

  let fullText = "";
  const toolLog: string[] = [];
  const calls: { name: string; success: boolean; error?: string }[] = [];
  let appliedMutation = false;
  let current = [...messages];

  for (let i = 0; i < 5; i++) {
    const res = await anthropic.messages.create({
      model: COACH_MODEL, max_tokens: 8000, system: systemPrompt, messages: current, tools,
    });
    const uses = res.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    for (const b of res.content) if (b.type === "text") fullText += b.text;
    if (uses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of uses) {
      const r = await handleToolCall(tu.name, tu.input as Record<string, unknown>, userId, undefined);
      calls.push({ name: tu.name, success: r.success, error: r.error });
      toolLog.push(r.success ? `${tu.name} → OK` : `${tu.name} → FAILED: ${r.error}`);
      if (r.notification) appliedMutation = true;
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r.data || { error: r.error }) });
    }
    current = [...current, { role: "assistant", content: res.content }, { role: "user", content: results }];
  }

  const grounded = groundStatusMarker(fullText, appliedMutation);
  const replay = buildAssistantContent(grounded, toolLog)
    .filter((b) => b.type === "text").map((b) => b.text).join("");
  return { grounded, calls, toolLog, appliedMutation, replay };
}

const statusOf = (t: string) => t.match(/\[STATUS:(question|done|info)\]/)?.[1] ?? "(none)";

/** Every planned workout, flattened — so "did the plan change?" means the whole plan. */
async function snapshot(planId: string) {
  const ws = await prisma.plannedWorkout.findMany({ where: { planId }, orderBy: { date: "asc" } });
  return new Map(
    ws.map((w) => [
      w.id,
      `${w.date.toISOString().slice(0, 10)}|${w.targetDistanceKm}|${w.targetPace}|${w.targetDurationMin}|${w.status}|${w.title}`,
    ])
  );
}

async function trial(n: number) {
  const { user, plan, sat, sun } = await setup(`t${n}`);
  const before = await snapshot(plan.id);
  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: JAN_MSG }];
    const t1 = await runTurn(user.id, messages);
    const all = [...t1.calls];
    const statuses = [statusOf(t1.grounded)];
    let turns = 1;

    // If it asked rather than acted, confirm — exactly as Jan did.
    if (t1.calls.length === 0) {
      messages.push({ role: "assistant", content: t1.replay });
      messages.push({ role: "user", content: "Confirmed" });
      const t2 = await runTurn(user.id, messages);
      all.push(...t2.calls);
      statuses.push(statusOf(t2.grounded));
      turns = 2;
    }

    const after = await snapshot(plan.id);
    const diffs: string[] = [];
    for (const [id, sig] of after) {
      const was = before.get(id);
      if (was === undefined) diffs.push(`added ${sig.split("|")[5]}`);
      else if (was !== sig) diffs.push(`${sig.split("|")[5]}: ${was.split("|").slice(0, 5).join("/")} -> ${sig.split("|").slice(0, 5).join("/")}`);
    }
    for (const [id, sig] of before) if (!after.has(id)) diffs.push(`removed ${sig.split("|")[5]}`);
    const changed = diffs.length > 0;

    const satAfter = await prisma.plannedWorkout.findUnique({ where: { id: sat.id } });
    const sunAfter = await prisma.plannedWorkout.findUnique({ where: { id: sun.id } });

    const applied = all.some((c) => c.success);
    const claimedDone = statuses.includes("done");
    const lying = claimedDone && !applied;

    console.log(`\n=== TRIAL ${n} (${turns} turn${turns > 1 ? "s" : ""}) ===`);
    console.log(`  tools called : ${all.length === 0 ? "NONE" : all.map((c) => `${c.name}[${c.success ? "ok" : "FAIL"}]`).join(", ")}`);
    for (const c of all.filter((c) => !c.success)) console.log(`     ! ${c.name}: ${String(c.error).slice(0, 160)}`);
    console.log(`  status       : ${statuses.join(" -> ")}`);
    console.log(`  plan changed : ${changed ? "YES" : "NO"}`);
    console.log(`  FALSE SUCCESS: ${lying ? "*** YES — BUG ***" : "no"}`);
    console.log(`  sat: ${satAfter?.date.toISOString().slice(0, 10)} ${satAfter?.targetDistanceKm}km · sun: ${sunAfter?.targetDistanceKm}km @ ${sunAfter?.targetPace}`);
    for (const d of diffs) console.log(`     ~ ${d}`);

    return { changed, lying, applied, calls: all.length };
  } finally { await prisma.user.delete({ where: { id: user.id } }); }
}

async function main() {
  const runs = Number(process.argv[2] || 3);
  console.log(`Model: ${COACH_MODEL} — ${runs} trial(s)\n`);
  const out = [];
  for (let i = 1; i <= runs; i++) out.push(await trial(i));

  const lying = out.filter((r) => r.lying).length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  called a tool        : ${out.filter((r) => r.calls > 0).length}/${runs}`);
  console.log(`  applied a real change: ${out.filter((r) => r.applied).length}/${runs}`);
  console.log(`  plan actually changed: ${out.filter((r) => r.changed).length}/${runs}`);
  console.log(`  FALSE SUCCESS        : ${lying}/${runs}`);
  console.log(`${"=".repeat(60)}`);
  process.exitCode = lying > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; }).finally(() => prisma.$disconnect());
