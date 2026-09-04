import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateWorkoutDefinition, describeWorkoutValidation, estimateDurationMin, type WorkoutDefinition } from "@/lib/guided-workout";
import { UTILITY_MODEL } from "@/lib/models";
import { ILLUSTRATED_LABELS } from "@/lib/exercise-art";
import { YOGA_POSE_HINTS } from "@/lib/tools";
import { resolveLang, LANGUAGE_FULL } from "@/lib/i18n";
import { sportProfile } from "@/lib/sport";
import { userTranslator } from "@/lib/i18n-server";

const anthropic = new Anthropic();

const DEFINITION_SPEC = `Return ONLY a JSON object, no other text:
{
  "title": "string (max 80 chars)",
  "focus": "string, e.g. core | hips & glutes | full body",
  "definition": {
    "warmupSec": 60,            // optional, 0-900
    "cooldownSec": 60,          // optional, 0-900
    "blocks": [                 // 1-3 blocks
      {
        "label": "Circuit",
        "rounds": 3,            // 1-10
        "restBetweenRoundsSec": 45,
        "exercises": [          // 3-8 per block
          { "name": "Plank", "art": "plank", "mode": "time", "workSec": 40, "restSec": 15, "note": "short form cue" },
          { "name": "Push-ups", "art": "push-ups", "mode": "reps", "reps": 12, "restSec": 30 }
        ]
      }
    ]
  }
}
"art" is the diagram key: the ILLUSTRATED EXERCISES name in lowercase with hyphens ("Side plank" -> "side-plank", "Calf raises (bent knee)" -> "calf-raises-bent-knee"). ALWAYS set it when an illustrated exercise fits — the picture is chosen by this key, not by the name, so it matters most when the name is written in another language. Omit it only for an exercise with no diagram.
Rules: bodyweight-only unless equipment was mentioned. Prefer mode "time" (30-45s work) for a smooth timer flow; use "reps" only where counting matters. Left/right exercises are TWO entries. Notes are short form cues. Respect any injuries listed — work around them, never load them.`;

const YOGA_SPEC = `Return ONLY a JSON object, no other text:
{
  "title": "string (max 80 chars)",
  "focus": "string, e.g. hips & hamstrings | shoulders & thoracic | wind-down",
  "definition": {
    "kind": "yoga",
    "blocks": [                 // 1-3 blocks, rounds 1 (2-3 only for a sequence deliberately repeated, e.g. a sun salutation)
      {
        "label": "Opening",
        "rounds": 1,
        "exercises": [          // 3-10 poses per block
          { "name": "Child's pose", "art": "childs-pose", "mode": "time", "workSec": 60, "restSec": 0, "note": "slow breaths, let the hips sink back" },
          { "name": "Low lunge (left)", "art": "low-lunge", "mode": "time", "workSec": 45, "restSec": 0, "note": "exhale, press the hips forward" }
        ]
      }
    ]
  }
}
This is a YOGA / MOBILITY FLOW of HELD POSES, not a circuit: every entry is mode "time" with workSec = the hold in seconds (10-300; 30-60s typical, 60-120s for deep hip and hamstring holds), restSec ALWAYS 0 (poses flow into one another — the app plays a soft chime and reads the next pose), never mode "reps", no warmupSec/cooldownSec. Left/right poses are TWO entries. "note" is a short breathing or alignment cue. "art" is the pose's diagram key from the POSES list — always set it. Use plain pose names ("Downward dog", not Sanskrit). 8-25 minutes total: open gently, build to the deepest holds in the middle, finish on the floor (supine twist, legs up the wall or savasana). Respect any injuries listed — never force a stretch on them.`;

/** A free-form request that reads as yoga / mobility / stretching (en, de, es) gets the yoga spec. */
const YOGA_REQUEST = /\b(yoga|yin|mobilit(?:y|ät)|movilidad|beweglich\w*|stretch\w*|dehn\w*|estira\w*|flexib\w*|flow)\b/i;

/**
 * POST /api/guided-workouts/generate — build a guided session server-side.
 * Two modes:
 *   { plannedWorkoutId } — session for a strength workout in the plan
 *     (reuses an existing linked session instead of regenerating)
 *   { request: "20 min core, no equipment" } — free-form
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.userId;
  const t = await userTranslator(userId);

  if (!rateLimit(`workout-gen:${userId}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: t("api.workoutGen.tooMany") }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const plannedWorkoutId = body.plannedWorkoutId ? String(body.plannedWorkoutId) : null;
  const freeform = body.request ? String(body.request).slice(0, 400) : null;
  if (!plannedWorkoutId && !freeform) {
    return NextResponse.json({ error: "plannedWorkoutId or request is required" }, { status: 400 });
  }

  let planned: { id: string; title: string; description: string | null; targetDurationMin: number | null; workoutType: string } | null = null;
  if (plannedWorkoutId) {
    planned = await prisma.plannedWorkout.findFirst({
      where: { id: plannedWorkoutId, plan: { userId } },
      select: { id: true, title: true, description: true, targetDurationMin: true, workoutType: true },
    });
    if (!planned) return NextResponse.json({ error: t("api.workoutGen.plannedNotFound") }, { status: 404 });

    // Reuse an already-generated session for this plan entry
    const existing = await prisma.guidedWorkout.findFirst({
      where: { userId, plannedWorkoutId: planned.id },
    });
    if (existing) {
      return NextResponse.json({ workout: { id: existing.id, title: existing.title, reused: true } });
    }
  }

  // Light context: injuries matter for exercise selection; full coach context doesn't
  const injuries = await prisma.healthLog.findMany({
    where: { userId, entryType: "injury", status: "active" },
    orderBy: { date: "desc" },
    take: 5,
    select: { description: true, bodyPart: true, severity: true },
  });
  const injuryBlock = injuries.length
    ? `\nACTIVE INJURIES (work around these): ${injuries.map((i) => `${i.bodyPart ? `[${i.bodyPart}] ` : ""}${i.description}${i.severity ? ` (${i.severity})` : ""}`).join("; ")}`
    : "";

  // Sport and language: plan strength sessions used to come out as English
  // sessions "for runners" with no diagram keys, whatever the athlete did.
  const prefs = await prisma.userProfile.findUnique({ where: { userId }, select: { primarySport: true, language: true } });
  const sp = sportProfile(prefs?.primarySport);
  const lang = resolveLang(prefs?.language);
  // A planned "yoga" session, or a free-form ask that reads as yoga /
  // mobility / stretching, gets a held-pose flow instead of a circuit.
  const kind: "sc" | "yoga" = planned ? (planned.workoutType === "yoga" ? "yoga" : "sc") : YOGA_REQUEST.test(freeform || "") ? "yoga" : "sc";
  const isYoga = kind === "yoga";
  const sportLine = isYoga
    ? sp.isClimbing
      ? " Climbers need shoulder and thoracic opening, hip mobility, forearm and wrist release, and a calm finish after wall sessions."
      : sp.sessionsBased
        ? ` Build mobility that supports ${sp.sport}.`
        : " Runners need hips, hamstrings, calves and ankles, plus a gentle spine and a calm finish."
    : sp.isClimbing
      ? " Climbers need antagonist work (push, shoulder stability), core, hips and forearm/finger care; never add hard finger loading to a conditioning session."
      : sp.sessionsBased
        ? ` Build conditioning that supports ${sp.sport}.`
        : "";
  // Always stated, English included: the planned workout's title/description
  // (or the free-form request) may be in another language — a plan written
  // while the athlete chatted in German, say — and without an explicit
  // instruction the model mirrors that text, so an English user got German
  // exercise names. The profile language wins; only the "art" key is English.
  const languageLine = ` LANGUAGE: write the title, focus, block labels, exercise names and notes in ${LANGUAGE_FULL[lang]} — the athlete's app language — even if the planned workout or request below is written in another language. Keep "art" keys and "mode" values exactly as specified, in English.`;

  const sessionNoun = isYoga ? "yoga/mobility flow" : "S&C session";
  const ask = planned
    ? `Create the guided ${sessionNoun} for this planned workout from a ${sp.athleteNoun}'s training plan:\nTitle: ${planned.title}\nDescription: ${planned.description || "(none)"}\nTarget duration: ${planned.targetDurationMin ? `${planned.targetDurationMin} min` : isYoga ? "12-15 min" : "15-20 min"}${injuryBlock}`
    : `Create a guided ${sessionNoun} for a ${sp.athleteNoun} who asked: "${freeform}"${injuryBlock}`;
  const system = isYoga
    ? `You are Brocco, a ${sp.coachNoun} designing yoga and mobility flows for ${sp.athleteNoun}s — held poses with breath cues that the app plays with a voice and a soft chime.${sportLine}${languageLine}\n\nPOSES (diagram key, then the plain name): ${YOGA_POSE_HINTS.join(", ")}\n\n${YOGA_SPEC}`
    : `You are Brocco, a ${sp.coachNoun} designing strength & conditioning sessions for ${sp.athleteNoun}s.${sportLine}${languageLine}\n\nILLUSTRATED EXERCISES (these have diagrams): ${ILLUSTRATED_LABELS.join(", ")}\n\n${DEFINITION_SPEC}`;

  let parsed: { title?: string; focus?: string; definition?: unknown } | null = null;
  let def: WorkoutDefinition | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !def; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: UTILITY_MODEL,
        // Sonnet 5 thinks by default; thinking shares the cap.
        max_tokens: 8000,
        system,
        messages: [
          {
            role: "user",
            content: attempt === 0 ? ask : `${ask}\n\nYour previous JSON was invalid: ${lastError}. Fix it and return ONLY the corrected JSON.`,
          },
        ],
      });
      // content may lead with a thinking block on newer models — find the text block
      const textBlock = response.content.find((c) => c.type === "text");
      const text = textBlock?.type === "text" ? textBlock.text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      // Be liberal in what we accept: definition nested (correct), at the
      // top level, or double-encoded as a JSON string.
      let defCandidate: unknown = parsed?.definition;
      if (typeof defCandidate === "string") {
        try { defCandidate = JSON.parse(defCandidate); } catch { /* leave as-is; validation reports it */ }
      }
      if (!defCandidate && parsed && Array.isArray((parsed as { blocks?: unknown }).blocks)) {
        defCandidate = parsed;
      }
      // The kind is ours, not the model's — it selects the validation rules.
      if (defCandidate && typeof defCandidate === "object") defCandidate = { ...(defCandidate as object), kind };
      const validated = validateWorkoutDefinition(defCandidate);
      if (validated.ok) def = { ...validated.def, kind };
      else {
        const reason = describeWorkoutValidation(validated);
        lastError = `${reason} (expected shape: {"title", "focus", "definition": {"blocks": [...]}})`;
        console.error(`[workout-gen] attempt ${attempt} invalid (${reason}); raw head: ${text.slice(0, 250)}`);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "generation failed";
    }
  }

  if (!def || !parsed) {
    console.error("Guided workout generation failed:", lastError);
    return NextResponse.json({ error: t("api.workoutGen.failed") }, { status: 502 });
  }

  const workout = await prisma.guidedWorkout.create({
    data: {
      userId,
      title: String(parsed.title || planned?.title || t("workout.untitled")).slice(0, 80),
      focus: parsed.focus ? String(parsed.focus).slice(0, 60) : null,
      durationMin: estimateDurationMin(def),
      definition: def as object,
      kind,
      source: planned ? "plan" : "brocco",
      plannedWorkoutId: planned?.id || null,
    },
  });

  return NextResponse.json({ workout: { id: workout.id, title: workout.title, reused: false } }, { status: 201 });
}
