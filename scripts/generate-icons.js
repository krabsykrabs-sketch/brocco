// Generate simple broccoli icon PNGs for PWA
// Uses raw PNG creation (no canvas dependency needed)

const fs = require('fs');
const { createCanvas } = (() => {
  try { return require('canvas'); } catch { return { createCanvas: null }; }
})();

function generateSVGIcon(size) {
  const fontSize = Math.round(size * 0.6);
  const y = Math.round(size * 0.7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="#030712"/>
  <text x="${size/2}" y="${y}" text-anchor="middle" font-size="${fontSize}">🥦</text>
</svg>`;
}

// Write SVG versions (universally supported fallback)
fs.writeFileSync('public/icons/icon-192.svg', generateSVGIcon(192));
fs.writeFileSync('public/icons/icon-512.svg', generateSVGIcon(512));

// If canvas is available, generate PNGs
if (createCanvas) {
  for (const size of [192, 512]) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#030712';
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, size * 0.2);
    ctx.fill();
    ctx.font = `${Math.round(size * 0.6)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🥦', size/2, size/2);
    fs.writeFileSync(`public/icons/icon-${size}.png`, canvas.toBuffer('image/png'));
    console.log(`Generated icon-${size}.png`);
  }
} else {
  console.log('canvas module not available, using SVG icons');
  // Copy SVGs as fallback PNGs won't exist, update manifest to use SVG
}
