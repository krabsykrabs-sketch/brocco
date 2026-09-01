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
  { slug: "dead-bug", label: "Dead bug", prompt: "lying flat on the back, side view: one arm reaching straight back overhead close to the floor while the OPPOSITE leg is extended straight out just above the floor, and at the same time the other arm points straight up at the ceiling and the other knee is bent ninety degrees directly above the hip" },
  { slug: "glute-bridge", label: "Glute bridge", prompt: "lying face up in a glute bridge, side view: knees bent with feet flat on the floor, hips lifted so the body makes a straight line from knees to shoulders, arms flat at the sides" },
  { slug: "single-leg-glute-bridge", label: "Single-leg glute bridge", prompt: "lying face up in a single leg glute bridge, side view: one foot flat on the floor with hips lifted, the other leg extended straight out in the air" },
  { slug: "superman-hold", label: "Superman hold", prompt: "lying face down in a superman hold, side view: arms extended forward and legs extended back, both lifted off the floor, chest raised" },
  { slug: "clamshells", label: "Clamshells", prompt: "lying on one side for a clamshell exercise, facing the viewer: knees bent and stacked, feet together, top knee lifted open away from the bottom knee" },
  { slug: "fire-hydrants", label: "Fire hydrants", prompt: "on hands and knees in the fire hydrant position, side view: back flat, one knee lifted out to the side while staying bent at ninety degrees" },
  { slug: "squats", label: "Squats", prompt: "at the bottom of a bodyweight squat, side view: hips pushed back and down, thighs near parallel to the floor, chest up, arms reaching forward for balance, feet flat" },
  { slug: "reverse-lunges", label: "Reverse lunges", prompt: "in the bottom of a reverse lunge, side view: one leg stepped back with the knee low toward the floor, front knee bent over the front foot, torso upright" },
  { slug: "lateral-lunges", label: "Lateral lunges", prompt: "in a lateral side lunge, facing the viewer: one leg bent deeply out to the side with the hip pushed back, the other leg straight, torso leaning slightly forward" },
  { slug: "calf-raises-straight-knee", label: "Calf raises (straight knee)", prompt: "shown from the hips down only, a close cropped side view of the two legs and feet at the top of a calf raise: both legs completely straight, standing high on the balls of the feet, heels lifted far off the floor with a large obvious gap beneath them" },
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

  // --- Beyond the presets: what Brocco commonly prescribes ---
  { slug: "bird-dog", label: "Bird dog", prompt: "on hands and knees with one arm extended straight forward and the opposite leg extended straight back, side view: back flat and level, the extended arm and leg parallel to the floor" },
  { slug: "bicycle-crunches", label: "Bicycle crunches", prompt: "lying face up doing a bicycle crunch, side view: shoulders lifted off the floor with hands behind the head, one knee drawn in toward the chest while the opposite leg extends straight out low, torso twisted so the elbow approaches the raised knee" },
  { slug: "mountain-climbers", label: "Mountain climbers", prompt: "in a high plank on straight arms driving one knee in toward the chest, side view: body straight from head to the extended rear heel, one knee pulled forward under the body" },
  { slug: "russian-twists", label: "Russian twists", prompt: "seated on the floor doing a russian twist, front view: torso leaned back at an angle, knees bent with the feet slightly off the floor, both hands clasped together and rotated to one side of the body" },
  { slug: "leg-raises", label: "Leg raises", prompt: "lying flat on the back doing a straight leg raise, side view: both legs straight and together lifted to about forty five degrees off the floor, arms flat by the sides, lower back pressed down" },
  { slug: "reverse-crunch", label: "Reverse crunch", prompt: "lying flat on the back doing a reverse crunch, side view: knees bent and drawn in above the chest with the hips curled up off the floor, arms flat by the sides" },
  { slug: "forward-lunges", label: "Forward lunges", prompt: "in the bottom of a forward lunge, side view: one leg stepped forward with the knee bent directly over the ankle, the back knee lowered toward the floor, torso tall and upright" },
  { slug: "bulgarian-split-squat", label: "Bulgarian split squat", prompt: "in a bulgarian split squat, side view: the back foot raised behind on a low bench, the front leg bent deeply with the knee over the ankle, torso upright" },
  { slug: "step-ups", label: "Step-ups", prompt: "stepping up onto a low sturdy box, side view: one foot planted flat on top of the box with that knee bent, the other leg still down on the floor behind, torso upright" },
  { slug: "single-leg-deadlift", label: "Single-leg deadlift", prompt: "in a single leg deadlift, side view: balancing on one straight leg with the torso hinged forward parallel to the floor, the other leg extended straight back in line with the torso, both arms hanging straight down" },
  { slug: "wall-sit", label: "Wall sit", prompt: "holding a wall sit, side view: back flat against a vertical wall, knees bent at ninety degrees with the thighs parallel to the floor, feet flat, arms resting at the sides" },
  { slug: "jump-squats", label: "Jump squats", prompt: "airborne in mid jump during a jump squat, side view: both feet HIGH above the ground with a large obvious empty gap between the feet and the ground line drawn well below them, legs straight and extended with toes pointing down, arms swung upward" },
  { slug: "skater-jumps", label: "Skater jumps", prompt: "landing a lateral skater jump, front view: landing on one bent leg with the other leg swept behind and across the body, torso leaned slightly forward, arms swung across" },
  { slug: "nordic-hamstring-curl", label: "Nordic hamstring curl", prompt: "performing a nordic hamstring curl, side view: kneeling upright with the ankles held down, the body lowering forward in one straight line from knees to head, arms reaching forward ready to catch the floor" },
  { slug: "single-leg-calf-raise", label: "Single-leg calf raise", prompt: "shown from the hips down only, a close cropped side view of a single leg calf raise: one straight leg standing high on the ball of the foot with the heel lifted far off the floor, the other foot lifted off the ground" },
  { slug: "donkey-kicks", label: "Donkey kicks", prompt: "on hands and knees doing a donkey kick, side view: back flat, one leg lifted behind with the knee bent ninety degrees and the sole of the foot pressing up toward the ceiling" },
  { slug: "high-knees", label: "High knees", prompt: "running in place with high knees, side view: one knee driven up to hip height with the thigh parallel to the floor, standing on the ball of the opposite foot, arms bent and swinging" },
  { slug: "butt-kicks", label: "Butt kicks", prompt: "running in place doing butt kicks, side view: one heel kicked up toward the buttock with that knee pointing down, standing on the ball of the opposite foot, arms bent" },
  { slug: "a-skips", label: "A-skips", prompt: "performing an A skip drill mid skip, side view: one knee driven up high with the ankle flexed, the opposite arm forward, balanced on the ball of the supporting foot" },
  { slug: "leg-swings", label: "Leg swings", prompt: "standing beside a wall doing a forward leg swing, side view: one hand on the wall for balance, standing on one straight leg while the other leg swings forward straight and high" },
  { slug: "pull-ups", label: "Pull-ups", prompt: "at the top of a pull up on a horizontal bar, front view: chin level with the bar, elbows bent and pulled down at the sides, body hanging straight below with the legs together" },
  { slug: "inverted-rows", label: "Inverted rows", prompt: "performing an inverted row under a low horizontal bar, side view: body straight and angled with the heels on the floor, hands gripping the bar overhead, elbows bent pulling the chest up to the bar" },
  { slug: "band-pull-aparts", label: "Band pull-aparts", prompt: "standing performing a band pull apart, front view: both arms straight out in front at shoulder height holding a stretched elastic band pulled wide apart across the chest" },
  { slug: "shoulder-external-rotation", label: "Shoulder external rotation", prompt: "standing performing a shoulder external rotation, front view: upper arms tucked against the sides with elbows bent ninety degrees, forearms rotating outward away from the body holding a stretched elastic band" },
  { slug: "finger-extensions", label: "Finger extensions", prompt: "a close cropped view of one hand only performing a finger extension exercise: fingers and thumb spread wide open against an elastic band looped around them" },
  { slug: "wrist-curls", label: "Wrist curls", prompt: "a close cropped side view of one forearm and hand performing a wrist curl: the forearm resting flat along the thigh with the palm facing up, the hand curling upward at the wrist" },
  { slug: "hip-flexor-stretch", label: "Hip flexor stretch", prompt: "holding a kneeling hip flexor stretch, side view: one knee down on the floor with that hip pushed forward, the other foot flat in front with the knee bent, torso tall and upright" },
  { slug: "pigeon-stretch", label: "Pigeon stretch", prompt: "holding a pigeon stretch on the floor, side view: the front leg bent and turned out with the shin across the floor, the back leg extended straight behind, torso upright over the front leg" },
  { slug: "downward-dog", label: "Downward dog", prompt: "holding a downward dog, side view: hands and feet on the floor with the hips lifted high forming an inverted V, arms and legs straight, head hanging between the arms" },
  { slug: "childs-pose", label: "Child's pose", prompt: "resting in child's pose, side view: kneeling with the hips sitting back on the heels, torso folded forward over the thighs, both arms extended forward flat on the floor" },
  { slug: "cat-cow", label: "Cat-cow", prompt: "on hands and knees in the cat position of a cat cow stretch, side view: the back rounded upward toward the ceiling, head tucked down, arms and thighs vertical" },
  { slug: "hamstring-stretch", label: "Hamstring stretch", prompt: "holding a seated hamstring stretch, side view: seated on the floor with one leg extended straight forward, torso hinged forward reaching both hands toward that foot" },
  { slug: "calf-stretch-wall", label: "Calf stretch (wall)", prompt: "holding a standing calf stretch against a wall, side view: both hands on the wall, one leg extended straight back with the heel pressed flat on the floor, the front knee bent" },
  { slug: "thoracic-rotation", label: "Thoracic rotation", prompt: "performing an open book thoracic rotation lying on one side on the floor, viewed from above: knees bent and stacked in front, the bottom arm resting on the floor, the top arm rotating open across the body toward the floor behind" },
  { slug: "ninety-ninety-hip-stretch", label: "90/90 hip stretch", prompt: "seated on the floor in the 90/90 hip stretch seen from directly above looking down: the front leg is bent so the thigh points forward and the shin crosses the body at a sharp right angle, the rear leg is bent so that thigh points out to the side with the shin trailing behind, both knees form clear right angles, the legs are NOT crossed" },
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
