import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv"; config();
import { unsupportedKm, generateNumberChecked } from "@/lib/number-guard";
import { COACH_MODEL } from "@/lib/models";
const anthropic = new Anthropic();

// The OLD source block: extras carried no distances (the gap that was fixed).
const OLD_SOURCE = `Weekly data for Jan:
Active plan: "Barcelona Marathon"
Running this week: 12.2km of 22km planned
Sessions: Easy Run: done 6.0km 33min 5:34/km
Missed (day fully over, no matching activity): S&C: Core & Hip Stability, Easy Run, Easy Run with Strides
Extra (unplanned) this week: VirtualRide "Zwift - Pacer Group Ride", Run "Afternoon Run"`;

// The OLD prompt: asks for numbers without saying where they may come from.
const OLD_SYSTEM = `You are Brocco, a broccoli running coach. Write a brief data-driven training check-in for Jan. 2-4 sentences max. Pattern: quick summary of the week so far + highlight something specific (good or concerning) + what's coming up + open question. Be direct and specific — reference actual numbers. Don't say "Hello" or generic greetings. Today is Saturday, August 8, 2026. End with a status line: [STATUS:question]your question[/STATUS] or [STATUS:info]key insight[/STATUS].`;

// Deliberately nudge toward the failure mode the screenshot captured.
const NUDGE = `\n\nOpen by stating the total kilometres achieved this week against the plan, as a single headline figure.`;

async function draft(system: string, source: string, correction: string | null) {
  const r = await anthropic.messages.create({
    model: COACH_MODEL, max_tokens: 250, system,
    messages: [{ role: "user", content: `${source}\n\nGenerate the opening analysis.${NUDGE}${correction ? `\n\n${correction}` : ""}` }],
  });
  const b = r.content.find((c) => c.type === "text");
  return b && b.type === "text" ? b.text.trim() : "";
}

async function main() {
  const N = Number(process.argv[2] || 5);
  let oldBad = 0, caught = 0, shipped = 0;
  for (let i = 1; i <= N; i++) {
    const raw = await draft(OLD_SYSTEM, OLD_SOURCE, null);
    const bad = unsupportedKm(raw, OLD_SOURCE, [22 - 12.2]);
    if (bad.length) oldBad++;
    console.log(`--- trial ${i}: ${bad.length ? `FABRICATED ${bad.join(",")}km` : "clean"}`);
    console.log(`    ${raw.replace(/\n/g," ").slice(0,130)}`);
    if (bad.length) {
      const checked = await generateNumberChecked(OLD_SOURCE, [22 - 12.2], "induce",
        (c) => draft(OLD_SYSTEM, OLD_SOURCE, c));
      const still = checked ? unsupportedKm(checked, OLD_SOURCE, [22 - 12.2]) : [];
      if (checked === null) { caught++; console.log("    guard -> fell back to template"); }
      else if (still.length === 0) { caught++; console.log("    guard -> retry produced a clean draft"); }
      else { shipped++; console.log(`    guard -> *** LEAKED ${still.join(",")}km ***`); }
    }
  }
  console.log(`\n  fabricated under the OLD prompt : ${oldBad}/${N}`);
  console.log(`  guard handled it                : ${caught}/${oldBad}`);
  console.log(`  leaked to the user              : ${shipped}`);
}
main().catch(e => console.error(e));
