import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { validateWorkoutDefinition, estimateDurationMin, type WorkoutDefinition } from "@/lib/guided-workout";
import { UTILITY_MODEL } from "@/lib/models";

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
          { "name": "Plank", "mode": "time", "workSec": 40, "restSec": 15, "note": "short form cue" },
          { "name": "Push-ups", "mode": "reps", "reps": 12, "restSec": 30 }
        ]
      }
    ]
  }
}
Rules: bodyweight-only unless equipment was mentioned. Prefer mode "time" (30-45s work) for a smooth timer flow; use "reps" only where counting matters. Left/right exercises are TWO entries. Notes are short form cues. Respect any injuries listed — work around them, never load them.`;

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

  if (!rateLimit(`workout-gen:${userId}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many workouts generated — take one of them and go train!" }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const plannedWorkoutId = body.plannedWorkoutId ? String(body.plannedWorkoutId) : null;
  const freeform = body.request ? String(body.request).slice(0, 400) : null;
  if (!plannedWorkoutId && !freeform) {
    return NextResponse.json({ error: "plannedWorkoutId or request is required" }, { status: 400 });
  }

  let planned: { id: string; title: string; description: string | null; targetDurationMin: number | null } | null = null;
  if (plannedWorkoutId) {
    planned = await prisma.plannedWorkout.findFirst({
      where: { id: plannedWorkoutId, plan: { userId } },
      select: { id: true, title: true, description: true, targetDurationMin: true },
    });
    if (!planned) return NextResponse.json({ error: "Planned workout not found" }, { status: 404 });

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

  const ask = planned
    ? `Create the guided S&C session for this planned workout from a runner's training plan:\nTitle: ${planned.title}\nDescription: ${planned.description || "(none)"}\nTarget duration: ${planned.targetDurationMin ? `${planned.targetDurationMin} min` : "15-20 min"}${injuryBlock}`
    : `Create a guided S&C session for a runner who asked: "${freeform}"${injuryBlock}`;

  let parsed: { title?: string; focus?: string; definition?: unknown } | null = null;
  let def: WorkoutDefinition | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < 2 && !def; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: UTILITY_MODEL,
        max_tokens: 2000,
        system: `You are Brocco, a running coach designing strength & conditioning sessions for runners. ${DEFINITION_SPEC}`,
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
      const validated = validateWorkoutDefinition(defCandidate);
      if (validated.ok) def = validated.def;
      else {
        lastError = `${validated.error} (expected shape: {"title", "focus", "definition": {"blocks": [...]}})`;
        console.error(`[workout-gen] attempt ${attempt} invalid (${validated.error}); raw head: ${text.slice(0, 250)}`);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "generation failed";
    }
  }

  if (!def || !parsed) {
    console.error("Guided workout generation failed:", lastError);
    return NextResponse.json({ error: "Couldn't generate a workout — try again or use a preset." }, { status: 502 });
  }

  const workout = await prisma.guidedWorkout.create({
    data: {
      userId,
      title: String(parsed.title || planned?.title || "Workout").slice(0, 80),
      focus: parsed.focus ? String(parsed.focus).slice(0, 60) : null,
      durationMin: estimateDurationMin(def),
      definition: def as object,
      source: planned ? "plan" : "brocco",
      plannedWorkoutId: planned?.id || null,
    },
  });

  return NextResponse.json({ workout: { id: workout.id, title: workout.title, reused: false } }, { status: 201 });
}
