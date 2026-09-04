/**
 * Exercise diagram generator (dev-only, run by hand).
 *
 *   npx tsx scripts/gen-exercise-art.ts --list-models     # what your key can use
 *   npx tsx scripts/gen-exercise-art.ts                   # 3 candidates for every missing diagram
 *   npx tsx scripts/gen-exercise-art.ts --only squats --n 6
 *   npx tsx scripts/gen-exercise-art.ts --promote squats 2   # candidate #2 becomes the diagram
 *
 * Candidates land in .art-candidates/ (gitignored) with an index.html contact
 * sheet — open it, pick the ones that read clearly, promote them. Promoted art
 * is committed to public/exercise-art/ and served statically; nothing is ever
 * generated at runtime.
 *
 * Cost: a few cents per candidate. A full library run is well under €20.
 */
import { config } from "dotenv";
import { writeFileSync, mkdirSync, existsSync, copyFileSync, readFileSync } from "fs";
import sharp from "sharp";
import { EXERCISE_ART, type ExerciseArt } from "../src/lib/exercise-art";

config();

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
const API = "https://generativelanguage.googleapis.com/v1beta";
const CAND_DIR = ".art-candidates";
const FINAL_DIR = "public/exercise-art";
const READY_JSON = "src/lib/exercise-art-ready.json";

/**
 * Function over aesthetics: one unmistakable pose, nothing to decode. Arrows
 * and text are excluded deliberately — image models place them unreliably, and
 * a wrong arrow on an instruction is worse than none.
 */
const STYLE = [
  "Simple instructional exercise diagram.",
  "A single generic human figure drawn as minimal line art: BOLD THICK heavy black outlines, uniform line weight, solid white fill,",
  "a plain circle for the head with NO face, no hair, no clothing detail, no muscle definition.",
  "Flat 2D vector style, even line weight throughout.",
  "Plain solid white background. No text, no letters, no numbers, no arrows, no labels, no watermark, no shading, no gradient.",
  "Draw only a single thin horizontal line where the body touches the ground.",
  "The entire figure is fully visible inside the frame with clear margin on all sides. Square image.",
].join(" ");

function args() {
  const a = process.argv.slice(2);
  const get = (flag: string) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    listModels: a.includes("--list-models"),
    promote: a.includes("--promote") ? a.slice(a.indexOf("--promote") + 1, a.indexOf("--promote") + 3) : null,
    only: get("--only"),
    n: Number(get("--n") || 3),
    force: a.includes("--force"),
  };
}

function requireKey(): string {
  if (!API_KEY) {
    console.error("GEMINI_API_KEY is not set. Add it to .env and re-run.");
    process.exit(1);
  }
  return API_KEY;
}

async function listModels() {
  const res = await fetch(`${API}/models?key=${requireKey()}&pageSize=200`);
  if (!res.ok) {
    console.error(`Model list failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { models?: Array<{ name: string; displayName?: string; description?: string }> };
  const all = data.models || [];
  const image = all.filter((m) => /image|imagen/i.test(m.name));
  console.log(`\n${image.length} image-capable model(s) your key can reach:\n`);
  for (const m of image) console.log(`  ${m.name.replace("models/", "")}\t${m.displayName || ""}`);
  console.log(`\nSet the one you want:  GEMINI_IMAGE_MODEL=<id>  (current default: ${MODEL})\n`);
}

/** One image, base64 PNG, or null if the model returned no picture. */
async function generateOne(ex: ExerciseArt): Promise<string | null> {
  const prompt = `${STYLE} The figure is ${ex.prompt}.`;
  const res = await fetch(`${API}/models/${MODEL}:generateContent?key=${requireKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  if (res.status === 404) {
    console.error(
      `\nModel "${MODEL}" not found for this key.\n` +
        `Run:  npx tsx scripts/gen-exercise-art.ts --list-models\n` +
        `then set GEMINI_IMAGE_MODEL in .env to one of the ids it prints.\n`
    );
    process.exit(1);
  }
  if (!res.ok) {
    console.warn(`  ! ${ex.slug}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return null;
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string } }> } }>;
  };
  for (const part of data.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData?.data) return part.inlineData.data;
  }
  return null;
}

async function saveTrimmed(b64: string, file: string) {
  await sharp(Buffer.from(b64, "base64"))
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 12 })
    .resize(600, 600, { fit: "contain", background: "#ffffff" })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

function contactSheet(slugs: string[], perSlug: Record<string, number>) {
  const rows = slugs
    .map((slug) => {
      const imgs = Array.from({ length: perSlug[slug] || 0 }, (_, i) =>
        `<figure><img src="./${slug}-${i + 1}.png" alt="${slug} candidate ${i + 1}"><figcaption>#${i + 1}</figcaption></figure>`
      ).join("");
      const label = EXERCISE_ART.find((e) => e.slug === slug)?.label || slug;
      return `<section><h2>${label}</h2><div class="row">${imgs}</div>
<code>npx tsx scripts/gen-exercise-art.ts --promote ${slug} &lt;n&gt;</code></section>`;
    })
    .join("\n");

  writeFileSync(
    `${CAND_DIR}/index.html`,
    `<!doctype html><meta charset="utf-8"><title>Exercise art candidates</title>
<style>
 body{font-family:system-ui,sans-serif;background:#faf6ea;color:#26301a;margin:0;padding:24px}
 h1{font-size:20px} h2{font-size:15px;margin:0 0 8px}
 section{background:#fff;border:2px solid #26301a;border-radius:14px;padding:14px;margin-bottom:18px}
 .row{display:flex;flex-wrap:wrap;gap:12px}
 figure{margin:0}
 img{width:190px;height:190px;object-fit:contain;background:#fff;border:2px solid #d8d2bc;border-radius:10px;display:block}
 figcaption{font-size:12px;color:#7d8468;text-align:center;margin-top:4px}
 code{display:inline-block;margin-top:10px;font-size:12px;background:#f4efdd;padding:5px 8px;border-radius:6px}
</style>
<h1>Exercise art candidates</h1>
<p>Pick the clearest pose per exercise, then run the promote command under it.</p>
${rows}`
  );
}

function promote(slug: string, index: string) {
  const src = `${CAND_DIR}/${slug}-${index}.png`;
  if (!existsSync(src)) {
    console.error(`No such candidate: ${src}`);
    process.exit(1);
  }
  mkdirSync(FINAL_DIR, { recursive: true });
  copyFileSync(src, `${FINAL_DIR}/${slug}.png`);

  const ready: string[] = JSON.parse(readFileSync(READY_JSON, "utf8"));
  if (!ready.includes(slug)) ready.push(slug);
  ready.sort();
  writeFileSync(READY_JSON, `${JSON.stringify(ready, null, 2)}\n`);
  const total = EXERCISE_ART.reduce((n, e) => n + 1 + (e.views?.length || 0), 0);
  console.log(`Promoted ${slug} #${index} -> ${FINAL_DIR}/${slug}.png  (${ready.length}/${total} done)`);
}

async function main() {
  const a = args();
  if (a.listModels) return listModels();
  if (a.promote) return promote(a.promote[0], a.promote[1]);

  requireKey();
  mkdirSync(CAND_DIR, { recursive: true });
  const ready: string[] = JSON.parse(readFileSync(READY_JSON, "utf8"));

  // One target per PICTURE: the primary drawing (id = slug) plus every extra
  // perspective (id = slug--view). Candidates, promotion and the ready list
  // all key on the id, so a view is handled exactly like a diagram.
  let targets: ExerciseArt[] = EXERCISE_ART.flatMap((e) => [
    e,
    ...(e.views || []).map((v) => ({ slug: `${e.slug}--${v.key}`, label: `${e.label} (${v.key})`, prompt: v.prompt })),
  ]);
  if (a.only) targets = targets.filter((e) => e.slug === a.only);
  else if (!a.force) targets = targets.filter((e) => !ready.includes(e.slug));

  if (targets.length === 0) {
    console.log("Nothing to generate (all promoted — use --force or --only <slug>).");
    return;
  }

  console.log(`Model: ${MODEL}\nGenerating ${a.n} candidate(s) for ${targets.length} exercise(s)...\n`);
  const perSlug: Record<string, number> = {};
  for (const ex of targets) {
    let saved = 0;
    for (let i = 0; i < a.n; i++) {
      const b64 = await generateOne(ex);
      if (!b64) continue;
      saved++;
      await saveTrimmed(b64, `${CAND_DIR}/${ex.slug}-${saved}.png`);
    }
    perSlug[ex.slug] = saved;
    console.log(`  ${saved}/${a.n}  ${ex.label}`);
  }

  contactSheet(targets.map((e) => e.slug), perSlug);
  console.log(`\nOpen ${CAND_DIR}/index.html to review and promote.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
