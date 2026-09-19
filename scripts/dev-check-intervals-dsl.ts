/**
 * Fixture check for the intervals.icu workout text. Run: npx tsx scripts/dev-check-intervals-dsl.ts
 * Guards the metres/minutes trap: intervals.icu reads "800m" as 800 MINUTES.
 */
import { renderWorkoutDsl } from "../src/lib/intervals-icu";

let failed = 0;
const check = (name: string, got: string, want: string) => {
  if (got.trim() !== want.trim()) {
    failed++;
    console.error(`FAIL ${name}\n--- got ---\n${got}\n--- want ---\n${want}\n`);
  } else console.log(`ok   ${name}`);
};

check(
  "sub-km reps are km, recoveries are minutes",
  renderWorkoutDsl({
    targetDistanceKm: null, targetPace: null, targetDurationMin: null, description: null,
    steps: [
      { kind: "warmup", duration_min: 15, pace: "6:45-7:05/km" },
      { kind: "repeat", times: 5, steps: [{ kind: "work", distance_km: 0.8, pace: "4:55-5:05/km" }, { kind: "recovery", duration_min: 3, pace: "7:00-7:30/km" }] },
      { kind: "cooldown", duration_min: 10 },
    ],
  } as never),
  "Warmup\n- 15m 6:45-7:05/km pace\n\n5x\n- 0.8km 4:55-5:05/km pace\n- 3m 7:00-7:30/km pace\n\nCooldown\n- 10m"
);
check(
  "strides of 80 m",
  renderWorkoutDsl({ targetDistanceKm: null, targetPace: null, targetDurationMin: null, description: null,
    steps: [{ kind: "repeat", times: 4, steps: [{ kind: "work", distance_km: 0.08 }, { kind: "recovery", duration_min: 1 }] }] } as never),
  "4x\n- 0.08km\n- 1m"
);
check(
  "no steps: distance fallback",
  renderWorkoutDsl({ targetDistanceKm: 8 as never, targetPace: "5:30/km", targetDurationMin: null, description: null, steps: null } as never),
  "- 8km 5:30/km pace"
);
// Nothing rendered may ever carry a bare "m" after a distance.
const all = renderWorkoutDsl({ targetDistanceKm: null, targetPace: null, targetDurationMin: null, description: null,
  steps: [{ kind: "work", distance_km: 0.4 }, { kind: "work", distance_km: 0.999 }] } as never);
if (/\b\d+m\b/.test(all)) { failed++; console.error(`FAIL distance rendered with a bare m suffix:\n${all}`); } else console.log("ok   no bare m for distances");

process.exit(failed ? 1 : 0);
