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
const SIDE_WORDS = /\b(?:left|right|links|rechts|izquierda|derecha|izquierdo|derecho)\b/g;

export function exerciseSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[àáâä]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i")
    .replace(/[òóôö]/g, "o").replace(/[ùúûü]/g, "u").replace(/ñ/g, "n").replace(/ß/g, "ss")
    .replace(SIDE_WORDS, " ")
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
  // --- Second expansion: power, climbing strength, mobility, warm-up ---
  { slug: "side-plank-hip-dips", label: "Side plank hip dips", prompt: "in a side plank lowering the hip toward the floor, front view: supported on one forearm with the body angled, feet stacked, the hips dropped low in the bottom of the dip" },
  { slug: "pallof-press", label: "Pallof press", prompt: "standing performing a pallof press, front view: feet apart in a stable stance, both hands pressed straight out from the chest holding a stretched elastic band that runs off to one side" },
  { slug: "copenhagen-plank", label: "Copenhagen plank", prompt: "holding a copenhagen plank, front view: supported on one forearm on the floor with the body straight and angled, the TOP leg resting on a low bench with the bottom leg lifted off the floor" },
  { slug: "v-ups", label: "V-ups", prompt: "at the top of a V-up, side view: balanced on the seat with straight legs lifted high and the straight torso lifted to meet them, hands reaching toward the feet, the body forming a sharp V" },
  { slug: "flutter-kicks", label: "Flutter kicks", prompt: "lying flat on the back doing flutter kicks, side view: both legs straight and just off the floor with one leg slightly higher than the other, hands tucked under the hips, shoulders down" },
  { slug: "plank-up-downs", label: "Plank up-downs", prompt: "mid transition between a forearm plank and a high plank, side view: one arm straight with the hand planted and the other still on its forearm, body held in one straight line from head to heels" },
  { slug: "hollow-rocks", label: "Hollow rocks", prompt: "rocking in the hollow body position, side view: lower back pressed down, arms extended straight overhead, straight legs lifted off the floor, the whole body curved like a shallow banana" },
  { slug: "box-jumps", label: "Box jumps", prompt: "landing softly on top of a low sturdy box, side view: both feet planted on the box with knees bent absorbing the landing, torso leaning slightly forward, arms swept back" },
  { slug: "pistol-squat", label: "Pistol squat", prompt: "at the bottom of a pistol squat, side view: balanced deep on one bent leg with that heel flat, the other leg extended straight out in front parallel to the floor, both arms reaching forward" },
  { slug: "lateral-band-walks", label: "Lateral band walks", prompt: "stepping sideways in a half squat with an elastic band around both ankles, front view: knees bent and pushed apart against the band tension, feet wide, torso upright" },
  { slug: "hip-thrust", label: "Hip thrust", prompt: "at the top of a hip thrust, side view: upper back resting on a low bench, knees bent with feet flat on the floor, hips driven up so the body is level from knees to shoulders" },
  { slug: "good-mornings", label: "Good mornings", prompt: "at the bottom of a good morning, side view: standing with a slight bend in the knees, hips pushed back and the flat back hinged forward to near parallel with the floor, hands at the head" },
  { slug: "split-squat", label: "Split squat", prompt: "in the bottom of a static split squat, side view: feet in a long split stance both flat on the floor, back knee lowered close to the ground, front knee bent over the ankle, torso upright" },
  { slug: "broad-jump", label: "Broad jump", prompt: "airborne in a standing broad jump, side view: the body travelling forward with both feet clearly off the ground and a large gap to the ground line below, knees tucked up, both arms swung forward" },
  { slug: "pogo-hops", label: "Pogo hops", prompt: "mid pogo hop, side view: both feet just off the ground with the ankles pointed down, legs almost straight and knees barely bent, body tall and upright, arms at the sides" },
  { slug: "hamstring-slider-curl", label: "Hamstring slider curl", prompt: "performing a sliding hamstring curl, side view: lying face up with the hips lifted off the floor and both heels on small sliders, the legs extending out straight away from the body" },
  { slug: "curtsy-lunge", label: "Curtsy lunge", prompt: "in the bottom of a curtsy lunge, front view: one leg stepped diagonally back behind and across the other, both knees bent, torso upright and facing forward" },
  { slug: "b-skips", label: "B-skips", prompt: "mid B-skip drill, side view: one knee driven up high and that lower leg snapping out forward straight ahead, balanced on the ball of the opposite foot, opposite arm driving forward" },
  { slug: "carioca", label: "Carioca", prompt: "mid carioca grapevine drill, front view: travelling sideways with one leg crossing in front of the other, hips rotated, arms out to the sides for balance" },
  { slug: "bounding", label: "Bounding", prompt: "airborne mid bound, side view: an exaggerated long running stride with both feet off the ground and a clear gap to the ground line, front knee driven up high, opposite arm forward" },
  { slug: "inchworm", label: "Inchworm", prompt: "mid inchworm, side view: feet planted with straight legs and hands walked far forward on the floor so the body forms a long shallow line from heels to hands, hips slightly raised" },
  { slug: "lock-off", label: "Lock-off", prompt: "holding a lock-off on a horizontal bar, front view: one arm bent hard with that elbow tucked and the chin at bar height, the other arm hanging straight down, body still" },
  { slug: "bent-over-rows", label: "Bent-over rows", prompt: "performing a bent over row, side view: knees slightly bent and the flat back hinged forward to about forty five degrees, both elbows pulled back past the ribs holding weights" },
  { slug: "shoulder-press", label: "Shoulder press", prompt: "at the top of a standing shoulder press, front view: feet apart, both arms pressed straight overhead holding weights, body tall with the ribs down" },
  { slug: "farmers-carry", label: "Farmer's carry", prompt: "walking in a farmer's carry, front view: standing tall with a heavy weight hanging at each side in straight arms, shoulders down and back, one foot stepping forward" },
  { slug: "push-up-plus", label: "Push-up plus", prompt: "at the top of a push-up plus, side view: high plank on straight arms with the body in one line, the upper back pushed up and rounded as the shoulder blades spread apart" },
  { slug: "chest-stretch-doorway", label: "Chest stretch (doorway)", prompt: "holding a doorway chest stretch, front view: standing in a door frame with one forearm pressed against the frame at shoulder height, elbow bent ninety degrees, torso rotated away" },
  { slug: "couch-stretch", label: "Couch stretch", prompt: "holding a couch stretch, side view: kneeling on one knee with that shin running up a wall behind and the foot high, the other foot flat in front with the knee bent, torso tall and upright" },
  { slug: "quad-stretch-standing", label: "Quad stretch (standing)", prompt: "holding a standing quad stretch, side view: balanced on one straight leg while the other heel is pulled up to the buttock by the hand on that side, knees together, body tall" },
  { slug: "butterfly-stretch", label: "Butterfly stretch", prompt: "holding a butterfly stretch, front view: seated on the floor with the soles of both feet pressed together and the knees dropped wide out to the sides, hands holding the feet, back tall" },
  { slug: "seated-spinal-twist", label: "Seated spinal twist", prompt: "holding a seated spinal twist, front view: seated on the floor with one leg crossed over the other and that knee bent up, the torso rotated toward the raised knee with the opposite elbow braced against it" },
  { slug: "worlds-greatest-stretch", label: "World's greatest stretch", prompt: "holding the world's greatest stretch, side view: a deep lunge with the front foot flat and the back leg extended straight behind, one hand on the floor inside the front foot and the other arm reaching up to the ceiling" },
  { slug: "figure-four-stretch", label: "Figure-four stretch", prompt: "holding a figure four glute stretch, side view: lying face up with one ankle crossed over the opposite thigh forming a triangle, both hands pulling the supporting thigh toward the chest" },
  { slug: "standing-forward-fold", label: "Standing forward fold", prompt: "holding a standing forward fold, side view: standing with straight legs and the torso folded all the way forward over them, hands hanging down toward the feet, head relaxed" },
  { slug: "knee-to-wall-ankle", label: "Ankle mobility (knee to wall)", prompt: "performing a knee to wall ankle mobility test, side view: one foot flat on the floor close to a vertical wall with the heel down, that knee driving forward to touch the wall, both hands on the wall" },
  { slug: "foam-roll-quads", label: "Foam roll quads", prompt: "foam rolling the quads, side view: lying face down propped on both forearms with a cylindrical foam roller under the front of one thigh, legs extended behind" },
  { slug: "foam-roll-calves", label: "Foam roll calves", prompt: "foam rolling the calves, side view: seated on the floor with hands planted behind, hips lifted slightly and a cylindrical foam roller under one calf, the other leg crossed on top" },
  { slug: "arm-circles", label: "Arm circles", prompt: "performing large arm circles, front view: standing tall with both arms extended straight out to the sides at shoulder height, palms open" },
  { slug: "hip-circles", label: "Hip circles", prompt: "performing standing hip circles, front view: standing with feet apart and both hands on the hips, the hips pushed out to one side in the middle of a circling motion" },
  { slug: "walking-knee-hugs", label: "Walking knee hugs", prompt: "mid walking knee hug, side view: standing tall on one straight leg while both hands pull the other bent knee up high against the chest" },
  { slug: "torso-twists", label: "Torso twists", prompt: "performing standing torso twists, front view: feet planted apart with the arms bent and held at chest height, the upper body rotated to one side while the hips stay square" },
  { slug: "face-pulls", label: "Face pulls", prompt: "standing performing a band face pull, front view: both arms pulling a stretched elastic band back toward the face at head height, elbows high and wide out to the sides, shoulder blades squeezed" },
  { slug: "scapular-pulls", label: "Scapular pulls", prompt: "hanging from a horizontal bar performing a scapular pull, front view: arms completely straight throughout, the whole body pulled up only slightly by the shoulder blades drawing down and together, legs hanging straight" },
  { slug: "negative-pull-ups", label: "Negative pull-ups", prompt: "lowering slowly from the top of a pull up on a horizontal bar, front view: chin near the bar with elbows bent, the body descending under control, legs hanging straight below" },
  { slug: "ninety-ninety-hip-stretch", label: "90/90 hip stretch", prompt: "seated on the floor in the 90/90 hip stretch seen from directly above looking down: the front leg is bent so the thigh points forward and the shin crosses the body at a sharp right angle, the rear leg is bent so that thigh points out to the side with the shin trailing behind, both knees form clear right angles, the legs are NOT crossed" },
];

const BY_SLUG = new Map(EXERCISE_ART.map((e) => [e.slug, e]));

/** Canonical exercise names, for steering Brocco's create_workout tool. */
export const ILLUSTRATED_LABELS = EXERCISE_ART.map((e) => e.label);

/**
 * Names that don't normalise onto a slug by themselves — shorthands and the
 * German/Spanish terms Brocco uses when coaching in those languages.
 * Not exhaustive by design: create_workout also emits an explicit `art` key,
 * and the token-overlap fallback below catches most of the rest.
 */
const ALIASES: Record<string, string> = {
  "hollow-hold": "hollow-body-hold",
  "hollow-body": "hollow-body-hold",
  "hohlkreuz-halten": "hollow-body-hold",
  "unterarmstutz": "plank",
  "seitstutz": "side-plank",
  "liegestutze": "push-ups",
  "liegestutz": "push-ups",
  "kniebeugen": "squats",
  "kniebeuge": "squats",
  "ausfallschritte": "forward-lunges",
  "ausfallschritt": "forward-lunges",
  "ruckwartige-ausfallschritte": "reverse-lunges",
  "wadenheben": "calf-raises-straight-knee",
  "klimmzuge": "pull-ups",
  "klimmzug": "pull-ups",
  "negativ-klimmzug": "negative-pull-ups",
  "negativ-klimmzuge": "negative-pull-ups",
  "negative-pull-up": "negative-pull-ups",
  "huftheben": "glute-bridge",
  "beckenheben": "glute-bridge",
  "unterarm-plank": "plank",
  "bergsteiger": "mountain-climbers",
  "hampelmann": "jump-squats",
  "wandsitz": "wall-sit",
  "sentadillas": "squats",
  "zancadas": "forward-lunges",
  "plancha": "plank",
  "plancha-lateral": "side-plank",
  "flexiones": "push-ups",
  "dominadas": "pull-ups",
  "puente-de-gluteos": "glute-bridge",
  "elevacion-de-talones": "calf-raises-straight-knee",
  "band-face-pull": "face-pulls",
  "face-pull": "face-pulls",
  "scapular-pull": "scapular-pulls",
  "skapula-pulls": "scapular-pulls",
};

/**
 * Every query token has to be covered by the candidate, so "Hollow Hold"
 * finds "hollow body hold" while "Scapular Pulls" does NOT collapse onto
 * "scapular push-ups" — a different exercise that happens to share a word.
 */
function fuzzyEntry(slug: string): ExerciseArt | null {
  const q = slug.split("-").filter((t) => t.length > 2);
  if (q.length === 0) return null;
  let best: ExerciseArt | null = null;
  let bestScore = 0;
  for (const e of EXERCISE_ART) {
    const tokens = new Set(e.slug.split("-").filter((t) => t.length > 2));
    if (!q.every((t) => tokens.has(t))) continue;
    const score = q.length / Math.max(q.length, tokens.size);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Is this a slug we have a diagram for? (validates create_workout's `art`) */
export function isArtSlug(slug: string): boolean {
  return BY_SLUG.has(slug);
}

export function artEntryFor(name: string): ExerciseArt | null {
  const slug = exerciseSlug(name);
  const direct = BY_SLUG.get(slug);
  if (direct) return direct;
  const aliased = ALIASES[slug];
  if (aliased) return BY_SLUG.get(aliased) ?? null;
  return fuzzyEntry(slug);
}

// Slugs whose art has actually been curated into public/exercise-art/.
// Maintained by `scripts/gen-exercise-art.ts --promote` — never edit by hand.
// Gating on this (rather than registry membership) means the player never
// renders a broken image for an exercise we haven't drawn yet.
import READY from "./exercise-art-ready.json";

const READY_SLUGS = new Set(READY as string[]);

/** Public path of this exercise's diagram, or null if we don't have one. */
export function artPathFor(name: string, artKey?: string | null): string | null {
  const entry = (artKey ? BY_SLUG.get(artKey) : undefined) ?? artEntryFor(name);
  return entry && READY_SLUGS.has(entry.slug) ? `/exercise-art/${entry.slug}.png` : null;
}
