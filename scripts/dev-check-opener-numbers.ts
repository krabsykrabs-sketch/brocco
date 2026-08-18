/**
 * Live-model check: does the coach invent distances in the daily opener?
 *   npx tsx scripts/dev-check-opener-numbers.ts [trials]
 *
 * Reproduces the exact week from the transcript where Brocco announced
 * "You hit 22.3km against 22km planned" on a week where it had been handed
 * 12.2km. Runs the real model against the real prompt N times and reports two
 * numbers: how often the raw draft fabricates a distance, and how often
 * anything fabricated still reaches the athlete after the guard.
 *
 * The first number is the model's behaviour and will never be zero. The second
 * is ours, and must be.
 *
 * Costs real tokens — run deliberately, not in CI.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";
config();

import { unsupportedKm, generateNumberChecked } from "@/lib/number-guard";
import { COACH_MODEL } from "@/lib/models";

const anthropic = new Anthropic();

// The week from the screenshot: two runs totalling 12.2km against 22km planned,
// three sessions missed to illness, and a 23.2km Zwift ride that is NOT running.
const SOURCE = `Weekly data for Jan:
Active plan: "Barcelona Marathon"
Running this week: 12.2km of 22km planned
Sessions: Easy Run: done 6.0km 33min 5:34/km
Missed (day fully over, no matching activity): S&C: Core & Hip Stability, Easy Run, Easy Run with Strides
Extra (unplanned) this week: VirtualRide "Zwift - Pacer Group Ride" 23.2km, Run "Afternoon Run" 6.2km 38min 6:07/km`;

const SYSTEM = `You are Brocco, a broccoli running coach. Write a brief data-driven training check-in for Jan. 2-4 sentences max. Pattern: quick summary of the week so far + highlight something specific (good or concerning) + what's coming up + open question. Be direct and specific. NUMBERS: quote only figures that appear in the data below, exactly as written. Never calculate, sum or estimate a distance — if a number you want is not in the data, leave it out and say it qualitatively instead. Running kilometres and bike kilometres are separate; never add them together. Don't say "Hello" or generic greetings. Today is Saturday, August 8, 2026. End with a status line: [STATUS:question]your question[/STATUS] or [STATUS:info]key insight[/STATUS].`;

const ALLOWED_DERIVED = [22 - 12.2]; // the shortfall is a legitimate subtraction

async function draft(correction: string | null): Promise<string> {
  const res = await anthropic.messages.create({
    model: COACH_MODEL,
    max_tokens: 250,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${SOURCE}\n\nGenerate the opening analysis.${correction ? `\n\n${correction}` : ""}`,
      },
    ],
  });
  const b = res.content.find((c) => c.type === "text");
  return b && b.type === "text" ? b.text.trim() : "";
}

async function main() {
  const runs = Number(process.argv[2] || 6);
  console.log(`Model: ${COACH_MODEL} — ${runs} trial(s)\n`);

  let rawBad = 0;
  let shippedBad = 0;
  let fellBack = 0;

  for (let i = 1; i <= runs; i++) {
    // First draft, unguarded — this is what the athlete used to see.
    const raw = await draft(null);
    const rawIssues = unsupportedKm(raw, SOURCE, ALLOWED_DERIVED);
    if (rawIssues.length > 0) rawBad++;

    // Now the same thing through the guard.
    const checked = await generateNumberChecked(SOURCE, ALLOWED_DERIVED, "opener-test", draft);
    if (checked === null) fellBack++;
    const shippedIssues = checked ? unsupportedKm(checked, SOURCE, ALLOWED_DERIVED) : [];
    if (shippedIssues.length > 0) shippedBad++;

    console.log(`--- trial ${i}`);
    console.log(`  raw draft   : ${rawIssues.length ? `FABRICATED ${rawIssues.join(", ")}km` : "clean"}`);
    console.log(`  after guard : ${checked === null ? "fell back to the templated line" : shippedIssues.length ? `*** STILL WRONG ${shippedIssues.join(", ")}km ***` : "clean"}`);
    console.log(`  text        : ${(checked ?? raw).replace(/\n/g, " ").slice(0, 150)}`);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  raw drafts that fabricated : ${rawBad}/${runs}   (the model's behaviour)`);
  console.log(`  fell back to template      : ${fellBack}/${runs}`);
  console.log(`  FABRICATION REACHING USER  : ${shippedBad}/${runs}   (must be 0)`);
  console.log(`${"=".repeat(60)}`);
  process.exitCode = shippedBad > 0 ? 1 : 0;
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exitCode = 2; });
