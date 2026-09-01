/**
 * Guided workout engine — shared between the Brocco tool (validation), the
 * API routes, and the player UI (segment timeline).
 *
 * A workout definition is blocks → rounds → exercises. Exercises are either
 * time-based (workSec) or rep-based (reps — the player shows "tap when done"
 * instead of a countdown). The player never interprets the definition
 * directly; it plays the flattened Segment[] from flattenSegments().
 */

import { isArtSlug } from "@/lib/exercise-art";

export interface WorkoutExercise {
  name: string;
  mode: "time" | "reps";
  workSec?: number; // mode=time
  reps?: number; // mode=reps
  restSec?: number; // rest AFTER this exercise (default 0)
  note?: string; // form cue, e.g. "keep hips level"
  /**
   * Diagram to show, as an exercise-art slug. Set by Brocco so the picture
   * survives the exercise being NAMED in any language; falls back to
   * matching on `name` when absent (older saved workouts).
   */
  art?: string;
}

export interface WorkoutBlock {
  label?: string; // e.g. "Circuit 1", "Finisher"
  rounds: number;
  restBetweenRoundsSec?: number;
  exercises: WorkoutExercise[];
}

export interface WorkoutDefinition {
  warmupSec?: number;
  cooldownSec?: number;
  blocks: WorkoutBlock[];
}

// --- Validation (LLM-facing — errors are returned to Brocco to fix) ---

const LIMITS = {
  blocks: 8,
  rounds: 50, // high ceiling for the custom interval timer; Brocco is told to stay ≤10

  exercisesPerBlock: 15,
  workSecMin: 5,
  workSecMax: 600,
  repsMin: 1,
  repsMax: 100,
  restSecMax: 600,
  warmupCooldownMax: 900,
  nameMax: 60,
  noteMax: 120,
};

export function validateWorkoutDefinition(
  raw: unknown
): { ok: true; def: WorkoutDefinition } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "definition must be an object" };
  const d = raw as Record<string, unknown>;

  const warmupSec = d.warmupSec == null ? undefined : Number(d.warmupSec);
  const cooldownSec = d.cooldownSec == null ? undefined : Number(d.cooldownSec);
  for (const [label, v] of [["warmupSec", warmupSec], ["cooldownSec", cooldownSec]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0 || v > LIMITS.warmupCooldownMax)) {
      return { ok: false, error: `${label} must be 0-${LIMITS.warmupCooldownMax} seconds` };
    }
  }

  if (!Array.isArray(d.blocks) || d.blocks.length === 0 || d.blocks.length > LIMITS.blocks) {
    return { ok: false, error: `blocks must be an array of 1-${LIMITS.blocks}` };
  }

  const blocks: WorkoutBlock[] = [];
  for (let bi = 0; bi < d.blocks.length; bi++) {
    const b = d.blocks[bi] as Record<string, unknown>;
    if (!b || typeof b !== "object") return { ok: false, error: `blocks[${bi}] must be an object` };
    const rounds = Number(b.rounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > LIMITS.rounds) {
      return { ok: false, error: `blocks[${bi}].rounds must be an integer 1-${LIMITS.rounds}` };
    }
    const restBetweenRoundsSec = b.restBetweenRoundsSec == null ? undefined : Number(b.restBetweenRoundsSec);
    if (restBetweenRoundsSec != null && (!Number.isFinite(restBetweenRoundsSec) || restBetweenRoundsSec < 0 || restBetweenRoundsSec > LIMITS.restSecMax)) {
      return { ok: false, error: `blocks[${bi}].restBetweenRoundsSec must be 0-${LIMITS.restSecMax}` };
    }
    if (!Array.isArray(b.exercises) || b.exercises.length === 0 || b.exercises.length > LIMITS.exercisesPerBlock) {
      return { ok: false, error: `blocks[${bi}].exercises must be an array of 1-${LIMITS.exercisesPerBlock}` };
    }
    const exercises: WorkoutExercise[] = [];
    for (let ei = 0; ei < b.exercises.length; ei++) {
      const e = b.exercises[ei] as Record<string, unknown>;
      const where = `blocks[${bi}].exercises[${ei}]`;
      if (!e || typeof e !== "object") return { ok: false, error: `${where} must be an object` };
      const name = String(e.name || "").trim();
      if (!name || name.length > LIMITS.nameMax) return { ok: false, error: `${where}.name is required (max ${LIMITS.nameMax} chars)` };
      const mode = e.mode === "reps" ? "reps" : e.mode === "time" ? "time" : null;
      if (!mode) return { ok: false, error: `${where}.mode must be "time" or "reps"` };
      const workSec = e.workSec == null ? undefined : Number(e.workSec);
      const reps = e.reps == null ? undefined : Number(e.reps);
      if (mode === "time" && (workSec == null || !Number.isFinite(workSec) || workSec < LIMITS.workSecMin || workSec > LIMITS.workSecMax)) {
        return { ok: false, error: `${where}.workSec must be ${LIMITS.workSecMin}-${LIMITS.workSecMax} for mode "time"` };
      }
      if (mode === "reps" && (reps == null || !Number.isInteger(reps) || reps < LIMITS.repsMin || reps > LIMITS.repsMax)) {
        return { ok: false, error: `${where}.reps must be an integer ${LIMITS.repsMin}-${LIMITS.repsMax} for mode "reps"` };
      }
      const restSec = e.restSec == null ? undefined : Number(e.restSec);
      if (restSec != null && (!Number.isFinite(restSec) || restSec < 0 || restSec > LIMITS.restSecMax)) {
        return { ok: false, error: `${where}.restSec must be 0-${LIMITS.restSecMax}` };
      }
      const note = e.note != null ? String(e.note).slice(0, LIMITS.noteMax) : undefined;
      // Unknown art slugs are dropped rather than rejected — a wrong key
      // should cost the picture, never the whole workout.
      const art = typeof e.art === "string" && isArtSlug(e.art) ? e.art : undefined;
      exercises.push({
        name,
        mode,
        ...(mode === "time" ? { workSec: Math.round(workSec!) } : { reps: reps! }),
        ...(restSec != null ? { restSec: Math.round(restSec) } : {}),
        ...(note ? { note } : {}),
        ...(art ? { art } : {}),
      });
    }
    blocks.push({
      ...(b.label ? { label: String(b.label).slice(0, LIMITS.nameMax) } : {}),
      rounds,
      ...(restBetweenRoundsSec != null ? { restBetweenRoundsSec: Math.round(restBetweenRoundsSec) } : {}),
      exercises,
    });
  }

  return {
    ok: true,
    def: {
      ...(warmupSec ? { warmupSec: Math.round(warmupSec) } : {}),
      ...(cooldownSec ? { cooldownSec: Math.round(cooldownSec) } : {}),
      blocks,
    },
  };
}

// --- Duration estimate ---

const EST_SEC_PER_REP = 3;

export function estimateDurationMin(def: WorkoutDefinition): number {
  let sec = (def.warmupSec || 0) + (def.cooldownSec || 0);
  for (const b of def.blocks) {
    let roundSec = 0;
    for (const e of b.exercises) {
      roundSec += e.mode === "time" ? e.workSec! : e.reps! * EST_SEC_PER_REP;
      roundSec += e.restSec || 0;
    }
    sec += roundSec * b.rounds + (b.restBetweenRoundsSec || 0) * Math.max(0, b.rounds - 1);
  }
  return Math.max(1, Math.round(sec / 60));
}

// --- Player timeline ---

export interface Segment {
  kind: "prep" | "warmup" | "work" | "rest" | "cooldown";
  /** Big label in the player ("Push-ups", "Rest", "Warm-up") */
  label: string;
  /** Countdown seconds; undefined = rep-based, player shows a Done button */
  seconds?: number;
  reps?: number;
  note?: string;
  /** "Round 2/3 · Circuit 1" style context line */
  context?: string;
  /** Next work segment's name, for the "Next: …" preview */
  nextUp?: string;
  /** exercise-art slug, when the definition specified one */
  art?: string;
}

const PREP_SEC = 10;

export function flattenSegments(def: WorkoutDefinition): Segment[] {
  const segs: Segment[] = [];
  segs.push({ kind: "prep", label: "Get ready", seconds: PREP_SEC });
  if (def.warmupSec) {
    segs.push({ kind: "warmup", label: "Warm-up", seconds: def.warmupSec, note: "Easy movement — arm circles, leg swings, light jog in place" });
  }

  const multiBlock = def.blocks.length > 1;
  def.blocks.forEach((b, bi) => {
    const blockName = b.label || (multiBlock ? `Block ${bi + 1}` : "");
    for (let round = 1; round <= b.rounds; round++) {
      const roundCtx = b.rounds > 1 ? `Round ${round}/${b.rounds}` : "";
      const context = [roundCtx, blockName].filter(Boolean).join(" · ") || undefined;
      b.exercises.forEach((e, ei) => {
        segs.push({
          kind: "work",
          label: e.name,
          ...(e.mode === "time" ? { seconds: e.workSec } : { reps: e.reps }),
          ...(e.note ? { note: e.note } : {}),
          ...(e.art ? { art: e.art } : {}),
          ...(context ? { context } : {}),
        });
        const isLastExercise = ei === b.exercises.length - 1;
        const isLastRound = round === b.rounds;
        // Per-exercise rest, except when a round-rest (or the end) follows
        if (e.restSec && !(isLastExercise && (isLastRound || b.restBetweenRoundsSec))) {
          segs.push({ kind: "rest", label: "Rest", seconds: e.restSec, ...(context ? { context } : {}) });
        }
        if (isLastExercise && !isLastRound && b.restBetweenRoundsSec) {
          segs.push({ kind: "rest", label: "Round rest", seconds: b.restBetweenRoundsSec, ...(context ? { context } : {}) });
        }
      });
    }
  });

  if (def.cooldownSec) {
    segs.push({ kind: "cooldown", label: "Cool-down", seconds: def.cooldownSec, note: "Slow stretching — hold each stretch, breathe" });
  }

  // Fill nextUp: the next WORK segment after each segment
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[j].kind === "work") {
        segs[i].nextUp = segs[j].label;
        break;
      }
    }
  }
  return segs;
}

// --- Presets (client-side constants, no DB row, no AI call) ---

export interface PresetWorkout {
  key: string;
  title: string;
  focus: string;
  emoji: string;
  description: string;
  definition: WorkoutDefinition;
}

function timed(name: string, workSec: number, restSec: number, note?: string): WorkoutExercise {
  return { name, mode: "time", workSec, restSec, ...(note ? { note } : {}) };
}

export const PRESET_WORKOUTS: PresetWorkout[] = [
  {
    key: "tabata",
    title: "Tabata",
    focus: "conditioning",
    emoji: "🔥",
    description: "The classic: 8 × 20s all-out / 10s rest. 4 brutal minutes.",
    definition: {
      blocks: [{ label: "Tabata", rounds: 8, exercises: [timed("Work", 20, 10, "All-out effort — pick one move and go")] }],
    },
  },
  {
    key: "core",
    title: "Runner's Core",
    focus: "core",
    emoji: "🎯",
    description: "15 min of trunk stability — the difference in the last 5k.",
    definition: {
      warmupSec: 60,
      cooldownSec: 60,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 45,
          exercises: [
            timed("Plank", 40, 15, "Straight line from head to heels"),
            timed("Side plank (left)", 30, 10, "Hips high, don't sag"),
            timed("Side plank (right)", 30, 10, "Hips high, don't sag"),
            timed("Dead bug", 40, 15, "Lower back pressed into the floor"),
            timed("Glute bridge", 40, 15, "Squeeze at the top"),
          ],
        },
      ],
    },
  },
  {
    key: "hips",
    title: "Hips & Glutes",
    focus: "hips & glutes",
    emoji: "🍑",
    description: "15 min for the muscles that keep your stride honest.",
    definition: {
      warmupSec: 60,
      cooldownSec: 60,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 45,
          exercises: [
            timed("Clamshells (left)", 30, 5, "Slow and controlled"),
            timed("Clamshells (right)", 30, 10, "Slow and controlled"),
            timed("Single-leg glute bridge (left)", 30, 5, "Hips level"),
            timed("Single-leg glute bridge (right)", 30, 10, "Hips level"),
            timed("Fire hydrants (left)", 30, 5),
            timed("Fire hydrants (right)", 30, 10),
            timed("Lateral lunges", 40, 15, "Alternate sides, sit back into the hip"),
          ],
        },
      ],
    },
  },
  {
    key: "calves",
    title: "Calves & Ankles",
    focus: "calves & ankles",
    emoji: "🦶",
    description: "10 min of lower-leg armor against shin splints and achilles niggles.",
    definition: {
      warmupSec: 45,
      cooldownSec: 45,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 30,
          exercises: [
            timed("Calf raises (straight knee)", 40, 15, "Full range, slow down phase"),
            timed("Calf raises (bent knee)", 40, 15, "Targets the soleus — runners' favorite"),
            // Tracing letters turns a static hold into an active proprioceptive
            // drill: the free leg keeps shifting your centre of mass, so the
            // standing ankle has to keep correcting. Picking up where you left
            // off means the alphabet spans the three rounds instead of being
            // rushed in one.
            timed("Single-leg balance — write the alphabet (left)", 40, 10,
              "Trace letters with your free foot, continuing from where you stopped last round. Eyes forward, barefoot if possible"),
            timed("Single-leg balance — write the alphabet (right)", 40, 15,
              "Same again on the other leg. Eyes forward, barefoot if possible"),
          ],
        },
      ],
    },
  },
  {
    key: "fullbody",
    title: "Full-Body Strength",
    focus: "full body",
    emoji: "💪",
    description: "20 min, no equipment — strength endurance for the whole chassis.",
    definition: {
      warmupSec: 90,
      cooldownSec: 90,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 60,
          exercises: [
            timed("Squats", 40, 20, "Chest up, weight in heels"),
            timed("Push-ups", 40, 20, "Knees down is fine — full range beats ego"),
            timed("Reverse lunges", 40, 20, "Alternate legs, knee tracks over toes"),
            timed("Plank shoulder taps", 40, 20, "Hips quiet, no rocking"),
            timed("Superman hold", 30, 30, "Squeeze glutes and mid-back"),
          ],
        },
      ],
    },
  },
];

/**
 * Climbing presets, shown instead of the runner set when the athlete's
 * primary sport is climbing. Tabata and Full-Body carry over from the
 * shared set; these cover what a climber actually rotates: fingers,
 * antagonists, shoulders, and a climber-shaped core.
 */
export const CLIMBING_PRESET_WORKOUTS: PresetWorkout[] = [
  {
    key: "hangboard",
    title: "Hangboard Repeaters",
    focus: "fingers",
    emoji: "🪝",
    description: "4 sets of 6 × 7s/3s on a comfortable edge. Experienced climbers only — fingers first.",
    definition: {
      warmupSec: 600,
      blocks: [
        {
          label: "Repeaters",
          rounds: 4,
          restBetweenRoundsSec: 180,
          exercises: [
            timed("Hang", 7, 3, "Open hand or half crimp — NEVER full crimp here"),
            timed("Hang", 7, 3, "Shoulders engaged, elbows soft"),
            timed("Hang", 7, 3, "Breathe"),
            timed("Hang", 7, 3, "Drop a foot to assist if failing"),
            timed("Hang", 7, 3, "Quality over completion"),
            timed("Hang", 7, 0, "Last one — then shake out"),
          ],
        },
      ],
    },
  },
  {
    key: "antagonist",
    title: "Antagonist Push",
    focus: "antagonists",
    emoji: "🛡️",
    description: "15 min of pushing — the insurance policy against climber's elbow and hunched shoulders.",
    definition: {
      warmupSec: 60,
      cooldownSec: 60,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 45,
          exercises: [
            timed("Push-ups", 40, 15, "Full range — knees down beats half reps"),
            timed("Pike push-ups", 30, 15, "Hips high, head between arms"),
            timed("Tricep dips (chair)", 30, 15, "Shoulders away from ears"),
            timed("Reverse wrist curls", 30, 15, "Light and slow — forearm extensors"),
            timed("Scapular push-ups", 30, 15, "Arms straight, just the shoulder blades"),
          ],
        },
      ],
    },
  },
  {
    key: "shoulders",
    title: "Shoulder Stability",
    focus: "shoulders",
    emoji: "🦾",
    description: "12 min for the cuff and scapula — what keeps gaston moves honest.",
    definition: {
      warmupSec: 60,
      cooldownSec: 60,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 40,
          exercises: [
            timed("YTW raises", 45, 15, "Face down, thumbs up, squeeze the mid-back"),
            timed("Wall slides", 40, 15, "Forearms on the wall, slide slow"),
            timed("Side plank (left)", 30, 10, "Top arm reaching to the ceiling"),
            timed("Side plank (right)", 30, 15, "Top arm reaching to the ceiling"),
          ],
        },
      ],
    },
  },
  {
    key: "climbcore",
    title: "Climber's Core",
    focus: "core",
    emoji: "🧗",
    description: "15 min of tension — hollow body and hips that keep your feet on.",
    definition: {
      warmupSec: 60,
      cooldownSec: 60,
      blocks: [
        {
          label: "Circuit",
          rounds: 3,
          restBetweenRoundsSec: 45,
          exercises: [
            timed("Hollow body hold", 30, 15, "Lower back pressed down — the body-tension position"),
            timed("Plank", 40, 15, "Straight line, glutes on"),
            timed("Side plank (left)", 30, 10, "Hips high"),
            timed("Side plank (right)", 30, 15, "Hips high"),
            timed("Superman hold", 30, 15, "The other half of body tension"),
          ],
        },
      ],
    },
  },
];

/** The preset list for an athlete: climbing gets its own rotation. */
export function presetsForSport(primarySport: string | null | undefined): PresetWorkout[] {
  if (primarySport && primarySport.includes("climb")) {
    // Tabata + Full-Body are sport-agnostic keepers.
    const shared = PRESET_WORKOUTS.filter((p) => p.key === "tabata" || p.key === "fullbody");
    return [...CLIMBING_PRESET_WORKOUTS, ...shared];
  }
  return PRESET_WORKOUTS;
}

/**
 * Compact, human-readable rendering of a definition — used to hand a
 * workout's content to Brocco in chat ("adjust this for me").
 */
export function describeDefinition(def: WorkoutDefinition): string {
  const lines: string[] = [];
  if (def.warmupSec) lines.push(`Warm-up ${Math.round(def.warmupSec / 60)} min`);
  def.blocks.forEach((b, i) => {
    const head = `${b.label || `Block ${i + 1}`}: ${b.rounds} round${b.rounds !== 1 ? "s" : ""}${
      b.restBetweenRoundsSec ? `, ${b.restBetweenRoundsSec}s between rounds` : ""
    }`;
    lines.push(head);
    for (const e of b.exercises) {
      const amount = e.mode === "time" ? `${e.workSec}s` : `${e.reps} reps`;
      lines.push(`- ${e.name} (${amount}${e.restSec ? `, rest ${e.restSec}s` : ""})`);
    }
  });
  if (def.cooldownSec) lines.push(`Cool-down ${Math.round(def.cooldownSec / 60)} min`);
  return lines.join("\n");
}

/** Build a custom interval definition (the "roll your own" timer). */
export function buildCustomInterval(workSec: number, restSec: number, rounds: number): WorkoutDefinition {
  return {
    blocks: [
      {
        label: "Intervals",
        rounds: Math.min(Math.max(Math.round(rounds), 1), 50),
        exercises: [
          {
            name: "Work",
            mode: "time",
            workSec: Math.min(Math.max(Math.round(workSec), 5), 600),
            restSec: Math.min(Math.max(Math.round(restSec), 0), 600),
          },
        ],
      },
    ],
  };
}
