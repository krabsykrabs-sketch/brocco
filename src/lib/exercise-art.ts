/**
 * Exercise diagram registry.
 *
 * The workout player shows a picture of the exercise instead of making the
 * athlete read two sentences mid-effort. Diagrams are keyed by EXERCISE, not
 * by workout — "Plank" appears in a dozen sessions and is drawn once — so the
 * library closes at a couple of dozen images.
 *
 * Art is generated once (scripts/gen-exercise-art.ts), curated by hand, and
 * committed to public/exercise-art/. Nothing is generated at runtime.
 */

export interface ExerciseArt {
  /** Filename stem and lookup key. */
  slug: string;
  /** The canonical exercise name Brocco should prefer when writing workouts. */
  label: string;
  /** Pose description handed to the image model. One position, no ambiguity. */
  prompt: string;
}

/**
 * Left/right are the same picture; anything else in parentheses is a real
 * variant ("calf raises (bent knee)") and stays part of the slug.
 */
export function exerciseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\((?:left|right)\)/g, "")
    .replace(/[—–-]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export const EXERCISE_ART: ExerciseArt[] = [
  { slug: "plank", label: "Plank", prompt: "holding a forearm plank, side view: body in one straight line from head to heels, forearms flat on the ground, elbows under shoulders, toes on the ground" },
  { slug: "side-plank", label: "Side plank", prompt: "holding a side plank, facing the viewer: body straight and angled, supported on one forearm on the ground, hips lifted high, feet stacked" },
  { slug: "hollow-body-hold", label: "Hollow body hold", prompt: "lying face up in a hollow body hold, side view: lower back pressed to the floor, arms extended straight overhead, legs straight and lifted just off the floor" },
  { slug: "dead-bug", label: "Dead bug", prompt: "lying face up in the dead bug position, side view: one arm extended overhead and the opposite leg extended straight out low, other arm and knee held up at ninety degrees" },
  { slug: "glute-bridge", label: "Glute bridge", prompt: "lying face up in a glute bridge, side view: knees bent with feet flat on the floor, hips lifted so the body makes a straight line from knees to shoulders, arms flat at the sides" },
  { slug: "single-leg-glute-bridge", label: "Single-leg glute bridge", prompt: "lying face up in a single leg glute bridge, side view: one foot flat on the floor with hips lifted, the other leg extended straight out in the air" },
  { slug: "superman-hold", label: "Superman hold", prompt: "lying face down in a superman hold, side view: arms extended forward and legs extended back, both lifted off the floor, chest raised" },
  { slug: "clamshells", label: "Clamshells", prompt: "lying on one side for a clamshell exercise, facing the viewer: knees bent and stacked, feet together, top knee lifted open away from the bottom knee" },
  { slug: "fire-hydrants", label: "Fire hydrants", prompt: "on hands and knees in the fire hydrant position, side view: back flat, one knee lifted out to the side while staying bent at ninety degrees" },
  { slug: "squats", label: "Squats", prompt: "at the bottom of a bodyweight squat, side view: hips pushed back and down, thighs near parallel to the floor, chest up, arms reaching forward for balance, feet flat" },
  { slug: "reverse-lunges", label: "Reverse lunges", prompt: "in the bottom of a reverse lunge, side view: one leg stepped back with the knee low toward the floor, front knee bent over the front foot, torso upright" },
  { slug: "lateral-lunges", label: "Lateral lunges", prompt: "in a lateral side lunge, facing the viewer: one leg bent deeply out to the side with the hip pushed back, the other leg straight, torso leaning slightly forward" },
  { slug: "calf-raises-straight-knee", label: "Calf raises (straight knee)", prompt: "standing on tiptoes in a calf raise, side view: legs completely straight, heels lifted high off the ground, body upright" },
  { slug: "calf-raises-bent-knee", label: "Calf raises (bent knee)", prompt: "performing a bent knee calf raise, side view: knees clearly bent in a slight squat, heels lifted high off the ground, torso upright" },
  { slug: "single-leg-balance-write-the-alphabet", label: "Single-leg balance — write the alphabet", prompt: "balancing on one straight leg, facing the viewer: the other foot lifted off the ground in front, arms held out to the sides for balance, body upright" },
  { slug: "push-ups", label: "Push-ups", prompt: "at the bottom of a push up, side view: body in one straight line from head to heels, elbows bent, chest close to the floor, hands under the shoulders" },
  { slug: "pike-push-ups", label: "Pike push-ups", prompt: "in a pike push up position, side view: hips high in an inverted V shape, hands and feet on the floor, head lowered between the arms, elbows bent" },
  { slug: "scapular-push-ups", label: "Scapular push-ups", prompt: "in a high plank on straight arms, side view: body straight from head to heels, arms completely locked out, shoulder blades squeezed together" },
  { slug: "plank-shoulder-taps", label: "Plank shoulder taps", prompt: "in a high plank on straight arms with one hand lifted to tap the opposite shoulder, side view: hips level, body straight, three points of contact on the floor" },
  { slug: "tricep-dips-chair", label: "Tricep dips (chair)", prompt: "performing a tricep dip off the edge of a simple chair, side view: hands gripping the chair edge behind the body, elbows bent, hips lowered in front of the chair, legs extended forward with heels on the floor" },
  { slug: "reverse-wrist-curls", label: "Reverse wrist curls", prompt: "seated performing a reverse wrist curl, side view: forearm resting flat on the thigh, palm facing down, hand bent upward at the wrist" },
  { slug: "wall-slides", label: "Wall slides", prompt: "standing with the back against a wall performing a wall slide, facing the viewer: arms raised with elbows and forearms pressed flat against the wall in a goalpost shape" },
  { slug: "ytw-raises", label: "YTW raises", prompt: "lying face down on the floor with the chest lifted, seen from above: arms extended straight out to form a wide Y shape overhead, thumbs pointing up" },
  { slug: "hang", label: "Hangboard hang", prompt: "hanging from a small wall mounted training board by the fingertips, facing the viewer: arms overhead and nearly straight with a slight bend, shoulders engaged and pulled down, legs hanging with knees slightly bent" },
];

const BY_SLUG = new Map(EXERCISE_ART.map((e) => [e.slug, e]));

/** Canonical exercise names, for steering Brocco's create_workout tool. */
export const ILLUSTRATED_LABELS = EXERCISE_ART.map((e) => e.label);

export function artEntryFor(name: string): ExerciseArt | null {
  return BY_SLUG.get(exerciseSlug(name)) ?? null;
}

// Slugs whose art has actually been curated into public/exercise-art/.
// Maintained by `scripts/gen-exercise-art.ts --promote` — never edit by hand.
// Gating on this (rather than registry membership) means the player never
// renders a broken image for an exercise we haven't drawn yet.
import READY from "./exercise-art-ready.json";

const READY_SLUGS = new Set(READY as string[]);

/** Public path of this exercise's diagram, or null if we don't have one. */
export function artPathFor(name: string): string | null {
  const slug = exerciseSlug(name);
  return READY_SLUGS.has(slug) ? `/exercise-art/${slug}.png` : null;
}
