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
import { translator, type DictKey } from "@/lib/dict";
import { DEFAULT_LANG, type Lang } from "@/lib/i18n";

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

/**
 * Validation failures are CODES with the position (1-based block/exercise)
 * and the limit that was crossed. The API route translates them for the
 * workout screen with `api.validation.workout.*`; the model-facing callers
 * (tool errors, the generate route's correction prompt) render them in
 * English via `describeWorkoutValidation`.
 */
export type WorkoutValidationCode =
  | "notObject"
  | "warmupRange"
  | "cooldownRange"
  | "blocksRange"
  | "blockNotObject"
  | "roundsRange"
  | "restBetweenRoundsRange"
  | "exercisesRange"
  | "exerciseNotObject"
  | "nameRequired"
  | "modeInvalid"
  | "workSecRange"
  | "repsRange"
  | "restSecRange";

export interface WorkoutValidationError {
  ok: false;
  code: WorkoutValidationCode;
  /** `block` / `exercise` are 1-based for display; limits as in LIMITS. */
  vars: { block?: number; exercise?: number; min?: number; max?: number };
}

/** English, model-facing wording with the JSON path (0-based) the model sent. */
export function describeWorkoutValidation(err: WorkoutValidationError): string {
  const { block, exercise, min, max } = err.vars;
  const blockPath = block != null ? `blocks[${block - 1}]` : "blocks";
  const exPath = exercise != null ? `${blockPath}.exercises[${exercise - 1}]` : blockPath;
  switch (err.code) {
    case "notObject": return "definition must be an object";
    case "warmupRange": return `warmupSec must be 0-${max} seconds`;
    case "cooldownRange": return `cooldownSec must be 0-${max} seconds`;
    case "blocksRange": return `blocks must be an array of 1-${max}`;
    case "blockNotObject": return `${blockPath} must be an object`;
    case "roundsRange": return `${blockPath}.rounds must be an integer 1-${max}`;
    case "restBetweenRoundsRange": return `${blockPath}.restBetweenRoundsSec must be 0-${max}`;
    case "exercisesRange": return `${blockPath}.exercises must be an array of 1-${max}`;
    case "exerciseNotObject": return `${exPath} must be an object`;
    case "nameRequired": return `${exPath}.name is required (max ${max} chars)`;
    case "modeInvalid": return `${exPath}.mode must be "time" or "reps"`;
    case "workSecRange": return `${exPath}.workSec must be ${min}-${max} for mode "time"`;
    case "repsRange": return `${exPath}.reps must be an integer ${min}-${max} for mode "reps"`;
    case "restSecRange": return `${exPath}.restSec must be 0-${max}`;
  }
}

export function validateWorkoutDefinition(
  raw: unknown
): { ok: true; def: WorkoutDefinition } | WorkoutValidationError {
  const fail = (code: WorkoutValidationCode, vars: WorkoutValidationError["vars"] = {}): WorkoutValidationError =>
    ({ ok: false, code, vars });
  if (!raw || typeof raw !== "object") return fail("notObject");
  const d = raw as Record<string, unknown>;

  const warmupSec = d.warmupSec == null ? undefined : Number(d.warmupSec);
  const cooldownSec = d.cooldownSec == null ? undefined : Number(d.cooldownSec);
  for (const [code, v] of [["warmupRange", warmupSec], ["cooldownRange", cooldownSec]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0 || v > LIMITS.warmupCooldownMax)) {
      return fail(code, { max: LIMITS.warmupCooldownMax });
    }
  }

  if (!Array.isArray(d.blocks) || d.blocks.length === 0 || d.blocks.length > LIMITS.blocks) {
    return fail("blocksRange", { max: LIMITS.blocks });
  }

  const blocks: WorkoutBlock[] = [];
  for (let bi = 0; bi < d.blocks.length; bi++) {
    const b = d.blocks[bi] as Record<string, unknown>;
    const block = bi + 1;
    if (!b || typeof b !== "object") return fail("blockNotObject", { block });
    const rounds = Number(b.rounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > LIMITS.rounds) {
      return fail("roundsRange", { block, max: LIMITS.rounds });
    }
    const restBetweenRoundsSec = b.restBetweenRoundsSec == null ? undefined : Number(b.restBetweenRoundsSec);
    if (restBetweenRoundsSec != null && (!Number.isFinite(restBetweenRoundsSec) || restBetweenRoundsSec < 0 || restBetweenRoundsSec > LIMITS.restSecMax)) {
      return fail("restBetweenRoundsRange", { block, max: LIMITS.restSecMax });
    }
    if (!Array.isArray(b.exercises) || b.exercises.length === 0 || b.exercises.length > LIMITS.exercisesPerBlock) {
      return fail("exercisesRange", { block, max: LIMITS.exercisesPerBlock });
    }
    const exercises: WorkoutExercise[] = [];
    for (let ei = 0; ei < b.exercises.length; ei++) {
      const e = b.exercises[ei] as Record<string, unknown>;
      const exercise = ei + 1;
      if (!e || typeof e !== "object") return fail("exerciseNotObject", { block, exercise });
      const name = String(e.name || "").trim();
      if (!name || name.length > LIMITS.nameMax) return fail("nameRequired", { block, exercise, max: LIMITS.nameMax });
      const mode = e.mode === "reps" ? "reps" : e.mode === "time" ? "time" : null;
      if (!mode) return fail("modeInvalid", { block, exercise });
      const workSec = e.workSec == null ? undefined : Number(e.workSec);
      const reps = e.reps == null ? undefined : Number(e.reps);
      if (mode === "time" && (workSec == null || !Number.isFinite(workSec) || workSec < LIMITS.workSecMin || workSec > LIMITS.workSecMax)) {
        return fail("workSecRange", { block, exercise, min: LIMITS.workSecMin, max: LIMITS.workSecMax });
      }
      if (mode === "reps" && (reps == null || !Number.isInteger(reps) || reps < LIMITS.repsMin || reps > LIMITS.repsMax)) {
        return fail("repsRange", { block, exercise, min: LIMITS.repsMin, max: LIMITS.repsMax });
      }
      const restSec = e.restSec == null ? undefined : Number(e.restSec);
      if (restSec != null && (!Number.isFinite(restSec) || restSec < 0 || restSec > LIMITS.restSecMax)) {
        return fail("restSecRange", { block, exercise, max: LIMITS.restSecMax });
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
  /** Big label in the player, already in the app language ("Push-ups", "Pause", "Aufwärmen") */
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

/**
 * "{n}"-style placeholders in a dictionary string. Kept here rather than in
 * i18n.ts because only the workout area needs it so far.
 */
export function fillTemplate(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * The player's timeline in the app language. Exercise names come from the
 * definition (written in the athlete's language by Brocco or the preset
 * resolver); the engine's own words — "Get ready", "Rest", "Round 2/3",
 * "Block 1", the warm-up/cool-down cues — come from the dictionary.
 */
export function flattenSegments(def: WorkoutDefinition, lang: Lang = DEFAULT_LANG): Segment[] {
  const t = translator(lang);
  const segs: Segment[] = [];
  segs.push({ kind: "prep", label: t("player.getReady"), seconds: PREP_SEC });
  if (def.warmupSec) {
    segs.push({ kind: "warmup", label: t("workout.warmUp"), seconds: def.warmupSec, note: t("workout.warmUpNote") });
  }

  const multiBlock = def.blocks.length > 1;
  def.blocks.forEach((b, bi) => {
    const blockName = b.label || (multiBlock ? `${t("workout.block")} ${bi + 1}` : "");
    for (let round = 1; round <= b.rounds; round++) {
      const roundCtx = b.rounds > 1 ? `${t("workout.roundLabel")} ${round}/${b.rounds}` : "";
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
          segs.push({ kind: "rest", label: t("player.rest"), seconds: e.restSec, ...(context ? { context } : {}) });
        }
        if (isLastExercise && !isLastRound && b.restBetweenRoundsSec) {
          segs.push({ kind: "rest", label: t("player.roundRest"), seconds: b.restBetweenRoundsSec, ...(context ? { context } : {}) });
        }
      });
    }
  });

  if (def.cooldownSec) {
    segs.push({ kind: "cooldown", label: t("workout.coolDown"), seconds: def.cooldownSec, note: t("workout.coolDownNote") });
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

/**
 * The library is stored as dictionary KEYS and resolved per language, so a
 * German athlete sees "Seitstütz (links)" in the player and a Spanish one
 * "Plancha lateral (izquierda)". The `art` slug is the language-independent
 * half: it is what picks the diagram, whatever the name says.
 */
type Side = "left" | "right";

interface PresetExerciseSource {
  nameKey: DictKey;
  side?: Side;
  art?: string;
  workSec: number;
  restSec: number;
  noteKey?: DictKey;
}

interface PresetBlockSource {
  labelKey: DictKey;
  rounds: number;
  restBetweenRoundsSec?: number;
  exercises: PresetExerciseSource[];
}

export interface PresetSource {
  key: string;
  titleKey: DictKey;
  focusKey: DictKey;
  emoji: string;
  descriptionKey: DictKey;
  warmupSec?: number;
  cooldownSec?: number;
  blocks: PresetBlockSource[];
}

function timed(nameKey: DictKey, art: string | undefined, workSec: number, restSec: number, noteKey?: DictKey, side?: Side): PresetExerciseSource {
  return { nameKey, ...(art ? { art } : {}), workSec, restSec, ...(noteKey ? { noteKey } : {}), ...(side ? { side } : {}) };
}

export const PRESET_WORKOUTS: PresetSource[] = [
  {
    key: "tabata",
    titleKey: "preset.tabataTitle",
    focusKey: "preset.focusConditioning",
    emoji: "🔥",
    descriptionKey: "preset.tabataDesc",
    blocks: [{ labelKey: "preset.blockTabata", rounds: 8, exercises: [timed("workout.workLabel", undefined, 20, 10, "preset.noteAllOut")] }],
  },
  {
    key: "core",
    titleKey: "preset.coreTitle",
    focusKey: "preset.focusCore",
    emoji: "🎯",
    descriptionKey: "preset.coreDesc",
    warmupSec: 60,
    cooldownSec: 60,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 45,
        exercises: [
          timed("preset.exPlank", "plank", 40, 15, "preset.noteStraightLine"),
          timed("preset.exSidePlank", "side-plank", 30, 10, "preset.noteHipsHighDontSag", "left"),
          timed("preset.exSidePlank", "side-plank", 30, 10, "preset.noteHipsHighDontSag", "right"),
          timed("preset.exDeadBug", "dead-bug", 40, 15, "preset.noteLowerBackFloor"),
          timed("preset.exGluteBridge", "glute-bridge", 40, 15, "preset.noteSqueezeTop"),
        ],
      },
    ],
  },
  {
    key: "hips",
    titleKey: "preset.hipsTitle",
    focusKey: "preset.focusHipsGlutes",
    emoji: "🍑",
    descriptionKey: "preset.hipsDesc",
    warmupSec: 60,
    cooldownSec: 60,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 45,
        exercises: [
          timed("preset.exClamshells", "clamshells", 30, 5, "preset.noteSlowControlled", "left"),
          timed("preset.exClamshells", "clamshells", 30, 10, "preset.noteSlowControlled", "right"),
          timed("preset.exSingleLegGluteBridge", "single-leg-glute-bridge", 30, 5, "preset.noteHipsLevel", "left"),
          timed("preset.exSingleLegGluteBridge", "single-leg-glute-bridge", 30, 10, "preset.noteHipsLevel", "right"),
          timed("preset.exFireHydrants", "fire-hydrants", 30, 5, undefined, "left"),
          timed("preset.exFireHydrants", "fire-hydrants", 30, 10, undefined, "right"),
          timed("preset.exLateralLunges", "lateral-lunges", 40, 15, "preset.noteAlternateSidesHip"),
        ],
      },
    ],
  },
  {
    key: "calves",
    titleKey: "preset.calvesTitle",
    focusKey: "preset.focusCalvesAnkles",
    emoji: "🦶",
    descriptionKey: "preset.calvesDesc",
    warmupSec: 45,
    cooldownSec: 45,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 30,
        exercises: [
          timed("preset.exCalfRaisesStraight", "calf-raises-straight-knee", 40, 15, "preset.noteFullRangeSlowDown"),
          timed("preset.exCalfRaisesBent", "calf-raises-bent-knee", 40, 15, "preset.noteSoleus"),
          // Tracing letters turns a static hold into an active proprioceptive
          // drill: the free leg keeps shifting your centre of mass, so the
          // standing ankle has to keep correcting. Picking up where you left
          // off means the alphabet spans the three rounds instead of being
          // rushed in one.
          timed("preset.exSingleLegBalanceAlphabet", "single-leg-balance-write-the-alphabet", 40, 10, "preset.noteAlphabetLeft", "left"),
          timed("preset.exSingleLegBalanceAlphabet", "single-leg-balance-write-the-alphabet", 40, 15, "preset.noteAlphabetRight", "right"),
        ],
      },
    ],
  },
  {
    key: "fullbody",
    titleKey: "preset.fullbodyTitle",
    focusKey: "preset.focusFullBody",
    emoji: "💪",
    descriptionKey: "preset.fullbodyDesc",
    warmupSec: 90,
    cooldownSec: 90,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 60,
        exercises: [
          timed("preset.exSquats", "squats", 40, 20, "preset.noteChestUpHeels"),
          timed("preset.exPushUps", "push-ups", 40, 20, "preset.noteKneesDownFine"),
          timed("preset.exReverseLunges", "reverse-lunges", 40, 20, "preset.noteAlternateLegsKnee"),
          timed("preset.exPlankShoulderTaps", "plank-shoulder-taps", 40, 20, "preset.noteHipsQuiet"),
          timed("preset.exSupermanHold", "superman-hold", 30, 30, "preset.noteSqueezeGlutesMidBack"),
        ],
      },
    ],
  },
];

/**
 * Climbing presets, shown instead of the runner set when the athlete's
 * primary sport is climbing. Tabata and Full-Body carry over from the
 * shared set; these cover what a climber actually rotates: fingers,
 * antagonists, shoulders, and a climber-shaped core.
 */
export const CLIMBING_PRESET_WORKOUTS: PresetSource[] = [
  {
    key: "hangboard",
    titleKey: "preset.hangboardTitle",
    focusKey: "preset.focusFingers",
    emoji: "🪝",
    descriptionKey: "preset.hangboardDesc",
    warmupSec: 600,
    blocks: [
      {
        labelKey: "preset.blockRepeaters",
        rounds: 4,
        restBetweenRoundsSec: 180,
        exercises: [
          timed("preset.exHang", "hang", 7, 3, "preset.noteHangCrimp"),
          timed("preset.exHang", "hang", 7, 3, "preset.noteHangShoulders"),
          timed("preset.exHang", "hang", 7, 3, "preset.noteBreathe"),
          timed("preset.exHang", "hang", 7, 3, "preset.noteHangFoot"),
          timed("preset.exHang", "hang", 7, 3, "preset.noteQualityOverCompletion"),
          timed("preset.exHang", "hang", 7, 0, "preset.noteLastShakeOut"),
        ],
      },
    ],
  },
  {
    key: "antagonist",
    titleKey: "preset.antagonistTitle",
    focusKey: "preset.focusAntagonists",
    emoji: "🛡️",
    descriptionKey: "preset.antagonistDesc",
    warmupSec: 60,
    cooldownSec: 60,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 45,
        exercises: [
          timed("preset.exPushUps", "push-ups", 40, 15, "preset.noteFullRangeKnees"),
          timed("preset.exPikePushUps", "pike-push-ups", 30, 15, "preset.noteHipsHighHead"),
          timed("preset.exTricepDipsChair", "tricep-dips-chair", 30, 15, "preset.noteShouldersAwayEars"),
          timed("preset.exReverseWristCurls", "reverse-wrist-curls", 30, 15, "preset.noteLightSlowExtensors"),
          timed("preset.exScapularPushUps", "scapular-push-ups", 30, 15, "preset.noteArmsStraightBlades"),
        ],
      },
    ],
  },
  {
    key: "shoulders",
    titleKey: "preset.shouldersTitle",
    focusKey: "preset.focusShoulders",
    emoji: "🦾",
    descriptionKey: "preset.shouldersDesc",
    warmupSec: 60,
    cooldownSec: 60,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 40,
        exercises: [
          timed("preset.exYtwRaises", "ytw-raises", 45, 15, "preset.noteFaceDownThumbs"),
          timed("preset.exWallSlides", "wall-slides", 40, 15, "preset.noteForearmsWall"),
          timed("preset.exSidePlank", "side-plank", 30, 10, "preset.noteTopArmCeiling", "left"),
          timed("preset.exSidePlank", "side-plank", 30, 15, "preset.noteTopArmCeiling", "right"),
        ],
      },
    ],
  },
  {
    key: "climbcore",
    titleKey: "preset.climbcoreTitle",
    focusKey: "preset.focusCore",
    emoji: "🧗",
    descriptionKey: "preset.climbcoreDesc",
    warmupSec: 60,
    cooldownSec: 60,
    blocks: [
      {
        labelKey: "preset.blockCircuit",
        rounds: 3,
        restBetweenRoundsSec: 45,
        exercises: [
          timed("preset.exHollowBodyHold", "hollow-body-hold", 30, 15, "preset.noteLowerBackTension"),
          timed("preset.exPlank", "plank", 40, 15, "preset.noteStraightLineGlutes"),
          timed("preset.exSidePlank", "side-plank", 30, 10, "preset.noteHipsHigh", "left"),
          timed("preset.exSidePlank", "side-plank", 30, 15, "preset.noteHipsHigh", "right"),
          timed("preset.exSupermanHold", "superman-hold", 30, 15, "preset.noteOtherHalfTension"),
        ],
      },
    ],
  },
];

/** A keyed preset turned into a playable, fully-worded workout in `lang`. */
export function resolvePreset(src: PresetSource, lang: Lang): PresetWorkout {
  const t = translator(lang);
  return {
    key: src.key,
    title: t(src.titleKey),
    focus: t(src.focusKey),
    emoji: src.emoji,
    description: t(src.descriptionKey),
    definition: {
      ...(src.warmupSec ? { warmupSec: src.warmupSec } : {}),
      ...(src.cooldownSec ? { cooldownSec: src.cooldownSec } : {}),
      blocks: src.blocks.map((b) => ({
        label: t(b.labelKey),
        rounds: b.rounds,
        ...(b.restBetweenRoundsSec != null ? { restBetweenRoundsSec: b.restBetweenRoundsSec } : {}),
        exercises: b.exercises.map((e) => ({
          name: e.side ? `${t(e.nameKey)} (${t(e.side === "left" ? "workout.left" : "workout.right")})` : t(e.nameKey),
          mode: "time" as const,
          workSec: e.workSec,
          restSec: e.restSec,
          ...(e.noteKey ? { note: t(e.noteKey) } : {}),
          ...(e.art ? { art: e.art } : {}),
        })),
      })),
    },
  };
}

/** The preset list for an athlete, worded in `lang`: climbing gets its own rotation. */
export function presetsForSport(primarySport: string | null | undefined, lang: Lang = DEFAULT_LANG): PresetWorkout[] {
  const sources =
    primarySport && primarySport.includes("climb")
      ? // Tabata + Full-Body are sport-agnostic keepers.
        [...CLIMBING_PRESET_WORKOUTS, ...PRESET_WORKOUTS.filter((p) => p.key === "tabata" || p.key === "fullbody")]
      : PRESET_WORKOUTS;
  return sources.map((p) => resolvePreset(p, lang));
}

/**
 * Compact, human-readable rendering of a definition in `lang` — used to hand
 * a workout's content to Brocco in chat ("adjust this for me"), where the
 * athlete sees it as the draft message.
 */
export function describeDefinition(def: WorkoutDefinition, lang: Lang = DEFAULT_LANG): string {
  const t = translator(lang);
  const lines: string[] = [];
  if (def.warmupSec) lines.push(`${t("workout.warmUp")} ${Math.round(def.warmupSec / 60)} ${t("common.min")}`);
  def.blocks.forEach((b, i) => {
    const head = `${b.label || `${t("workout.block")} ${i + 1}`}: ${b.rounds} ${b.rounds === 1 ? t("workout.round") : t("workout.roundsPlural")}${
      b.restBetweenRoundsSec ? `, ${b.restBetweenRoundsSec}s ${t("workout.betweenRounds")}` : ""
    }`;
    lines.push(head);
    for (const e of b.exercises) {
      const amount = e.mode === "time" ? `${e.workSec}s` : `${e.reps} ${t("common.reps")}`;
      lines.push(`- ${e.name} (${amount}${e.restSec ? `, ${t("common.rest")} ${e.restSec}s` : ""})`);
    }
  });
  if (def.cooldownSec) lines.push(`${t("workout.coolDown")} ${Math.round(def.cooldownSec / 60)} ${t("common.min")}`);
  return lines.join("\n");
}

/** Build a custom interval definition (the "roll your own" timer), worded in `lang`. */
export function buildCustomInterval(workSec: number, restSec: number, rounds: number, lang: Lang = DEFAULT_LANG): WorkoutDefinition {
  const t = translator(lang);
  return {
    blocks: [
      {
        label: t("workout.intervals"),
        rounds: Math.min(Math.max(Math.round(rounds), 1), 50),
        exercises: [
          {
            name: t("workout.workLabel"),
            mode: "time",
            workSec: Math.min(Math.max(Math.round(workSec), 5), 600),
            restSec: Math.min(Math.max(Math.round(restSec), 0), 600),
          },
        ],
      },
    ],
  };
}
