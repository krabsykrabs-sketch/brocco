/**
 * Regenerate the full app icon set from the brand mascot.
 * Usage: node scripts/generate-icons.mjs
 *
 * Source: public/brand/brocco-runner.png (transparent background).
 * - icon-64:            transparent, used as the in-app avatar (chat bubbles, header)
 * - icon-192/512:       dark tile, referenced by manifest.json (PWA install icon)
 * - apple-touch-icon:   dark tile, 180px (iOS home screen — no transparency allowed)
 * - maskable-192/512:   dark tile with extra safe-zone padding (Android adaptive icons)
 * - src/app/icon.png:   transparent, 192px — Next.js serves this as the favicon
 */
import sharp from "sharp";

const SRC = "public/brand/brocco-runner.png";
const TILE_BG = { r: 8, g: 15, b: 26, alpha: 1 }; // gray-950-ish, matches the app background

async function mascot(size, scale) {
  // Trim transparent borders, then fit into `scale` fraction of the canvas
  const inner = Math.round(size * scale);
  return sharp(SRC)
    .trim()
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function transparentIcon(size, out) {
  const content = await mascot(size, 0.94);
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toFile(out);
}

async function tileIcon(size, scale, out) {
  const content = await mascot(size, scale);
  await sharp({ create: { width: size, height: size, channels: 4, background: TILE_BG } })
    .composite([{ input: content, gravity: "center" }])
    .png()
    .toFile(out);
}

await transparentIcon(64, "public/icons/icon-64.png");
await transparentIcon(192, "src/app/icon.png");
await tileIcon(192, 0.84, "public/icons/icon-192.png");
await tileIcon(512, 0.84, "public/icons/icon-512.png");
await tileIcon(180, 0.84, "public/icons/apple-touch-icon.png");
await tileIcon(192, 0.62, "public/icons/maskable-192.png");
await tileIcon(512, 0.62, "public/icons/maskable-512.png");
console.log("icons generated");
