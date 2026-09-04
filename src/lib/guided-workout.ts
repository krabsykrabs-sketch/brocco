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
  /** "sc" (default): timer circuits. "yoga": a flow of held poses with breath cues — no reps, no rest blocks. */
  kind?: "sc" | "yoga";
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
 * A yoga flow is held poses, nothing else: every entry is timed (10 s–5 min),
 * rest is meaningless (the next pose IS the rest), and a sequence repeats at
 * most three times (sun salutations). Everything else inherits LIMITS.
 */
const YOGA_LIMITS = {
  rounds: 3,
  workSecMin: 10,
  workSecMax: 300,
  exercisesPerBlock: 24, // sides are separate entries, so a flow runs longer than a circuit
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
  /** `block` / `exercise` are 1-based for display; limits as in LIMITS. `kind` is set when a yoga-only rule fired. */
  vars: { block?: number; exercise?: number; min?: number; max?: number; kind?: "yoga" };
}

/** English, model-facing wording with the JSON path (0-based) the model sent. */
export function describeWorkoutValidation(err: WorkoutValidationError): string {
  const { block, exercise, min, max, kind } = err.vars;
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
    case "modeInvalid":
      return kind === "yoga"
        ? `${exPath}.mode must be "time" — a yoga flow holds poses for workSec seconds, it never counts reps`
        : `${exPath}.mode must be "time" or "reps"`;
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
  const kind: "sc" | "yoga" = d.kind === "yoga" ? "yoga" : "sc";
  const yoga = kind === "yoga";

  // A flow has no warm-up/cool-down bookends — the first and last poses are
  // those. Sent anyway, they're dropped rather than rejected.
  const warmupSec = yoga || d.warmupSec == null ? undefined : Number(d.warmupSec);
  const cooldownSec = yoga || d.cooldownSec == null ? undefined : Number(d.cooldownSec);
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
    const maxRounds = yoga ? YOGA_LIMITS.rounds : LIMITS.rounds;
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > maxRounds) {
      return fail("roundsRange", { block, max: maxRounds });
    }
    const restBetweenRoundsSec = yoga || b.restBetweenRoundsSec == null ? undefined : Number(b.restBetweenRoundsSec);
    if (restBetweenRoundsSec != null && (!Number.isFinite(restBetweenRoundsSec) || restBetweenRoundsSec < 0 || restBetweenRoundsSec > LIMITS.restSecMax)) {
      return fail("restBetweenRoundsRange", { block, max: LIMITS.restSecMax });
    }
    const maxExercises = yoga ? YOGA_LIMITS.exercisesPerBlock : LIMITS.exercisesPerBlock;
    if (!Array.isArray(b.exercises) || b.exercises.length === 0 || b.exercises.length > maxExercises) {
      return fail("exercisesRange", { block, max: maxExercises });
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
      if (yoga && mode === "reps") return fail("modeInvalid", { block, exercise, kind: "yoga" });
      const workSec = e.workSec == null ? undefined : Number(e.workSec);
      const reps = e.reps == null ? undefined : Number(e.reps);
      const workMin = yoga ? YOGA_LIMITS.workSecMin : LIMITS.workSecMin;
      const workMax = yoga ? YOGA_LIMITS.workSecMax : LIMITS.workSecMax;
      if (mode === "time" && (workSec == null || !Number.isFinite(workSec) || workSec < workMin || workSec > workMax)) {
        return fail("workSecRange", { block, exercise, min: workMin, max: workMax });
      }
      if (mode === "reps" && (reps == null || !Number.isInteger(reps) || reps < LIMITS.repsMin || reps > LIMITS.repsMax)) {
        return fail("repsRange", { block, exercise, min: LIMITS.repsMin, max: LIMITS.repsMax });
      }
      // Yoga: rest is ignored, not an error — the flow moves pose to pose.
      const restSec = yoga || e.restSec == null ? undefined : Number(e.restSec);
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
      kind,
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
/** A flow opens with a short "Settle in" instead of a countdown-style "Get ready". */
const SETTLE_SEC = 5;

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
  if (def.kind === "yoga") return flattenFlow(def, t);
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

/**
 * The yoga timeline: one "Settle in" breath, then pose after pose. No rest
 * segments (the definition never carries rest), no warm-up/cool-down. Rounds
 * still apply — a sun salutation repeats — and show as "Round 2/3" context.
 */
function flattenFlow(def: WorkoutDefinition, t: ReturnType<typeof translator>): Segment[] {
  const segs: Segment[] = [{ kind: "prep", label: t("player.settleIn"), seconds: SETTLE_SEC }];
  const multiBlock = def.blocks.length > 1;
  def.blocks.forEach((b, bi) => {
    const blockName = b.label || (multiBlock ? `${t("workout.block")} ${bi + 1}` : "");
    for (let round = 1; round <= b.rounds; round++) {
      const roundCtx = b.rounds > 1 ? `${t("workout.roundLabel")} ${round}/${b.rounds}` : "";
      const context = [roundCtx, blockName].filter(Boolean).join(" · ") || undefined;
      for (const e of b.exercises) {
        segs.push({
          kind: "work",
          label: e.name,
          seconds: e.mode === "time" ? e.workSec : (e.reps ?? 1) * EST_SEC_PER_REP,
          ...(e.note ? { note: e.note } : {}),
          ...(e.art ? { art: e.art } : {}),
          ...(context ? { context } : {}),
        });
      }
    }
  });
  for (let i = 0; i < segs.length - 1; i++) segs[i].nextUp = segs[i + 1].label;
  return segs;
}

// --- Presets (client-side constants, no DB row, no AI call) ---

export interface PresetWorkout {
  key: string;
  kind: "sc" | "yoga";
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
  /** Which tab of the Workouts screen it lives on; "sc" when absent. */
  kind?: "sc" | "yoga";
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

/** A held pose: name, diagram, hold seconds, breath/alignment cue — never any rest. */
function pose(nameKey: DictKey, art: string, holdSec: number, cueKey: DictKey, side?: Side): PresetExerciseSource {
  return timed(nameKey, art, holdSec, 0, cueKey, side);
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


/**
 * Yoga flows. Same dictionary-keyed shape as the S&C presets, `kind: "yoga"`:
 * every entry is a held pose with a breath/alignment cue and no rest. Sides
 * are separate entries so the player can announce "Pigeon (left)" and the
 * ring counts one side at a time. Durations are the hold sums (+5 s settle).
 */
export const YOGA_PRESET_WORKOUTS: PresetSource[] = [
  {
    key: "yoga-morning",
    kind: "yoga",
    titleKey: "preset.yogaMorningTitle",
    focusKey: "preset.focusMobility",
    emoji: "🌅",
    descriptionKey: "preset.yogaMorningDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseChildsPose", "childs-pose", 45, "yoga.cueChildsPose"),
          pose("yoga.poseCat", "cat-pose", 30, "yoga.cueCat"),
          pose("yoga.poseCow", "cow-pose", 30, "yoga.cueCow"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 40, "yoga.cueThreadTheNeedle", "left"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 40, "yoga.cueThreadTheNeedle", "right"),
          pose("yoga.posePuppy", "puppy-pose", 40, "yoga.cuePuppy"),
          pose("yoga.poseSphinx", "sphinx-pose", 30, "yoga.cueSphinx"),
          pose("yoga.poseDownwardDog", "downward-dog", 45, "yoga.cueDownwardDog"),
          pose("yoga.poseLowLunge", "low-lunge", 45, "yoga.cueLowLunge", "left"),
          pose("yoga.poseLowLunge", "low-lunge", 45, "yoga.cueLowLunge", "right"),
          pose("yoga.poseStandingForwardFold", "standing-forward-fold", 45, "yoga.cueStandingForwardFold"),
          pose("yoga.poseMountain", "mountain-pose", 30, "yoga.cueMountain"),
          pose("yoga.poseChair", "chair-pose", 30, "yoga.cueChair"),
          pose("yoga.poseTree", "tree-pose", 30, "yoga.cueTree", "left"),
          pose("yoga.poseTree", "tree-pose", 30, "yoga.cueTree", "right"),
          pose("yoga.poseGarland", "garland-pose", 45, "yoga.cueGarland"),
        ],
      },
    ],
  },
  {
    key: "yoga-postrun",
    kind: "yoga",
    titleKey: "preset.yogaPostRunTitle",
    focusKey: "preset.focusRecovery",
    emoji: "🏃",
    descriptionKey: "preset.yogaPostRunDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseStandingForwardFold", "standing-forward-fold", 45, "yoga.cueStandingForwardFold"),
          pose("yoga.poseLowLunge", "low-lunge", 45, "yoga.cueLowLunge", "left"),
          pose("yoga.poseLowLunge", "low-lunge", 45, "yoga.cueLowLunge", "right"),
          pose("yoga.poseHalfSplit", "half-split", 45, "yoga.cueHalfSplit", "left"),
          pose("yoga.poseHalfSplit", "half-split", 45, "yoga.cueHalfSplit", "right"),
          pose("yoga.poseLizard", "lizard-pose", 45, "yoga.cueLizard", "left"),
          pose("yoga.poseLizard", "lizard-pose", 45, "yoga.cueLizard", "right"),
          pose("yoga.poseDownwardDog", "downward-dog", 45, "yoga.cueDownwardDogPedal"),
          pose("yoga.poseKneelingHipFlexor", "kneeling-hip-flexor-stretch", 45, "yoga.cueKneelingHipFlexor", "left"),
          pose("yoga.poseKneelingHipFlexor", "kneeling-hip-flexor-stretch", 45, "yoga.cueKneelingHipFlexor", "right"),
          pose("yoga.posePigeon", "pigeon-pose", 60, "yoga.cuePigeon", "left"),
          pose("yoga.posePigeon", "pigeon-pose", 60, "yoga.cuePigeon", "right"),
          pose("yoga.poseReclinedFigureFour", "reclined-figure-four", 45, "yoga.cueReclinedFigureFour", "left"),
          pose("yoga.poseReclinedFigureFour", "reclined-figure-four", 45, "yoga.cueReclinedFigureFour", "right"),
          pose("yoga.poseSeatedForwardFold", "seated-forward-fold", 60, "yoga.cueSeatedForwardFold"),
        ],
      },
    ],
  },
  {
    key: "yoga-hips",
    kind: "yoga",
    titleKey: "preset.yogaHipsTitle",
    focusKey: "preset.focusHips",
    emoji: "🪷",
    descriptionKey: "preset.yogaHipsDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseChildsPose", "childs-pose", 60, "yoga.cueChildsPose"),
          pose("yoga.poseLowLunge", "low-lunge", 60, "yoga.cueLowLunge", "left"),
          pose("yoga.poseLowLunge", "low-lunge", 60, "yoga.cueLowLunge", "right"),
          pose("yoga.poseLizard", "lizard-pose", 60, "yoga.cueLizard", "left"),
          pose("yoga.poseLizard", "lizard-pose", 60, "yoga.cueLizard", "right"),
          pose("yoga.poseGarland", "garland-pose", 60, "yoga.cueGarland"),
          pose("yoga.poseButterfly", "butterfly-pose", 90, "yoga.cueButterfly"),
          pose("yoga.posePigeon", "pigeon-pose", 90, "yoga.cuePigeon", "left"),
          pose("yoga.posePigeon", "pigeon-pose", 90, "yoga.cuePigeon", "right"),
          pose("yoga.poseHappyBaby", "happy-baby", 60, "yoga.cueHappyBaby"),
          pose("yoga.poseReclinedFigureFour", "reclined-figure-four", 60, "yoga.cueReclinedFigureFour", "left"),
          pose("yoga.poseReclinedFigureFour", "reclined-figure-four", 60, "yoga.cueReclinedFigureFour", "right"),
          pose("yoga.poseSupineTwist", "supine-twist", 45, "yoga.cueSupineTwist", "left"),
          pose("yoga.poseSupineTwist", "supine-twist", 45, "yoga.cueSupineTwist", "right"),
        ],
      },
    ],
  },
  {
    key: "yoga-evening",
    kind: "yoga",
    titleKey: "preset.yogaEveningTitle",
    focusKey: "preset.focusWindDown",
    emoji: "🌙",
    descriptionKey: "preset.yogaEveningDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseChildsPose", "childs-pose", 90, "yoga.cueChildsPose"),
          pose("yoga.poseCat", "cat-pose", 30, "yoga.cueCat"),
          pose("yoga.poseCow", "cow-pose", 30, "yoga.cueCow"),
          pose("yoga.posePuppy", "puppy-pose", 60, "yoga.cuePuppy"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 60, "yoga.cueThreadTheNeedle", "left"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 60, "yoga.cueThreadTheNeedle", "right"),
          pose("yoga.poseSphinx", "sphinx-pose", 90, "yoga.cueSphinx"),
          pose("yoga.poseSeatedForwardFold", "seated-forward-fold", 90, "yoga.cueSeatedForwardFold"),
          pose("yoga.poseButterfly", "butterfly-pose", 90, "yoga.cueButterfly"),
          pose("yoga.poseSeatedTwist", "seated-twist", 45, "yoga.cueSeatedTwist", "left"),
          pose("yoga.poseSeatedTwist", "seated-twist", 45, "yoga.cueSeatedTwist", "right"),
          pose("yoga.poseSupineTwist", "supine-twist", 60, "yoga.cueSupineTwist", "left"),
          pose("yoga.poseSupineTwist", "supine-twist", 60, "yoga.cueSupineTwist", "right"),
          pose("yoga.poseHappyBaby", "happy-baby", 60, "yoga.cueHappyBaby"),
          pose("yoga.poseLegsUpTheWall", "legs-up-the-wall", 180, "yoga.cueLegsUpTheWall"),
          pose("yoga.poseSavasana", "savasana", 150, "yoga.cueSavasana"),
        ],
      },
    ],
  },
  {
    key: "yoga-climber",
    kind: "yoga",
    titleKey: "preset.yogaClimberTitle",
    focusKey: "preset.focusShouldersThoracic",
    emoji: "🧗",
    descriptionKey: "preset.yogaClimberDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseChildsPose", "childs-pose", 45, "yoga.cueChildsPose"),
          pose("yoga.poseCat", "cat-pose", 30, "yoga.cueCat"),
          pose("yoga.poseCow", "cow-pose", 30, "yoga.cueCow"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 60, "yoga.cueThreadTheNeedle", "left"),
          pose("yoga.poseThreadTheNeedle", "thread-the-needle", 60, "yoga.cueThreadTheNeedle", "right"),
          pose("yoga.posePuppy", "puppy-pose", 60, "yoga.cuePuppy"),
          pose("yoga.poseSphinx", "sphinx-pose", 45, "yoga.cueSphinx"),
          pose("yoga.poseCobra", "cobra-pose", 30, "yoga.cueCobra"),
          pose("yoga.poseDownwardDog", "downward-dog", 45, "yoga.cueDownwardDog"),
          pose("yoga.poseCamel", "camel-pose", 45, "yoga.cueCamel"),
          pose("yoga.poseLocust", "locust-pose", 30, "yoga.cueLocust"),
          pose("yoga.poseSeatedTwist", "seated-twist", 45, "yoga.cueSeatedTwist", "left"),
          pose("yoga.poseSeatedTwist", "seated-twist", 45, "yoga.cueSeatedTwist", "right"),
          pose("yoga.poseSupineTwist", "supine-twist", 45, "yoga.cueSupineTwist", "left"),
          pose("yoga.poseSupineTwist", "supine-twist", 45, "yoga.cueSupineTwist", "right"),
          pose("yoga.poseSavasana", "savasana", 60, "yoga.cueSavasana"),
        ],
      },
    ],
  },
  {
    key: "yoga-yin",
    kind: "yoga",
    titleKey: "preset.yogaYinTitle",
    focusKey: "preset.focusRecovery",
    emoji: "🕯️",
    descriptionKey: "preset.yogaYinDesc",
    blocks: [
      {
        labelKey: "preset.blockFlow",
        rounds: 1,
        exercises: [
          pose("yoga.poseChildsPose", "childs-pose", 120, "yoga.cueYinEdge"),
          pose("yoga.poseButterfly", "butterfly-pose", 180, "yoga.cueButterfly"),
          pose("yoga.poseLowLunge", "low-lunge", 120, "yoga.cueLowLunge", "left"),
          pose("yoga.poseLowLunge", "low-lunge", 120, "yoga.cueLowLunge", "right"),
          pose("yoga.poseSphinx", "sphinx-pose", 150, "yoga.cueSphinx"),
          pose("yoga.posePigeon", "pigeon-pose", 180, "yoga.cuePigeon", "left"),
          pose("yoga.posePigeon", "pigeon-pose", 180, "yoga.cuePigeon", "right"),
          pose("yoga.poseSeatedForwardFold", "seated-forward-fold", 180, "yoga.cueSeatedForwardFold"),
          pose("yoga.poseSupineTwist", "supine-twist", 90, "yoga.cueSupineTwist", "left"),
          pose("yoga.poseSupineTwist", "supine-twist", 90, "yoga.cueSupineTwist", "right"),
          pose("yoga.poseSavasana", "savasana", 90, "yoga.cueSavasana"),
        ],
      },
    ],
  },
  {
    key: "yoga-sun",
    kind: "yoga",
    titleKey: "preset.yogaSunTitle",
    focusKey: "preset.focusWarmUp",
    emoji: "☀️",
    descriptionKey: "preset.yogaSunDesc",
    blocks: [
      {
        labelKey: "preset.blockSunSalutation",
        rounds: 3,
        exercises: [
          pose("yoga.poseMountain", "mountain-pose", 15, "yoga.cueSunFlow"),
          pose("yoga.poseChair", "chair-pose", 15, "yoga.cueChair"),
          pose("yoga.poseStandingForwardFold", "standing-forward-fold", 15, "yoga.cueStandingForwardFold"),
          pose("yoga.poseLowLunge", "low-lunge", 15, "yoga.cueLowLunge", "left"),
          pose("yoga.posePlank", "plank", 15, "yoga.cuePlank"),
          pose("yoga.poseCobra", "cobra-pose", 15, "yoga.cueCobra"),
          pose("yoga.poseDownwardDog", "downward-dog", 20, "yoga.cueDownwardDog"),
          pose("yoga.poseLowLunge", "low-lunge", 15, "yoga.cueLowLunge", "right"),
          pose("yoga.poseStandingForwardFold", "standing-forward-fold", 15, "yoga.cueStandingForwardFold"),
          pose("yoga.poseMountain", "mountain-pose", 20, "yoga.cueMountain"),
        ],
      },
    ],
  },
];

/** A keyed preset turned into a playable, fully-worded workout in `lang`. */
export function resolvePreset(src: PresetSource, lang: Lang): PresetWorkout {
  const t = translator(lang);
  const kind = src.kind ?? "sc";
  return {
    key: src.key,
    kind,
    title: t(src.titleKey),
    focus: t(src.focusKey),
    emoji: src.emoji,
    description: t(src.descriptionKey),
    definition: {
      kind,
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

/**
 * The preset list for an athlete, worded in `lang`. S&C: climbing gets its
 * own rotation. Yoga: every flow is for everyone, but the one written for
 * the athlete's sport leads the list.
 */
export function presetsForSport(primarySport: string | null | undefined, lang: Lang = DEFAULT_LANG, kind: "sc" | "yoga" = "sc"): PresetWorkout[] {
  const climber = !!primarySport && primarySport.includes("climb");
  let sources: PresetSource[];
  if (kind === "yoga") {
    const lead = climber ? "yoga-climber" : "yoga-postrun";
    sources = [...YOGA_PRESET_WORKOUTS.filter((p) => p.key === lead), ...YOGA_PRESET_WORKOUTS.filter((p) => p.key !== lead)];
  } else {
    sources = climber
      ? // Tabata + Full-Body are sport-agnostic keepers.
        [...CLIMBING_PRESET_WORKOUTS, ...PRESET_WORKOUTS.filter((p) => p.key === "tabata" || p.key === "fullbody")]
      : PRESET_WORKOUTS;
  }
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
  const yoga = def.kind === "yoga";
  def.blocks.forEach((b, i) => {
    if (yoga) {
      // A flow reads as a list of holds; the block line only earns its place when it repeats or there are several.
      if (b.rounds > 1 || def.blocks.length > 1) {
        lines.push(`${b.label || `${t("workout.block")} ${i + 1}`}: ${b.rounds} ${b.rounds === 1 ? t("workout.round") : t("workout.roundsPlural")}`);
      }
      for (const e of b.exercises) lines.push(`- ${e.name} (${e.workSec}s)`);
      return;
    }
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
