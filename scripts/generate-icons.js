const sharp = require('sharp');
const path = require('path');

async function generateIcon(size) {
  const fontSize = Math.round(size * 0.55);
  const y = Math.round(size * 0.72);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#030712"/>
    <circle cx="${size/2}" cy="${size * 0.45}" r="${size * 0.28}" fill="#16a34a"/>
    <circle cx="${size * 0.38}" cy="${size * 0.38}" r="${size * 0.15}" fill="#22c55e"/>
    <circle cx="${size * 0.62}" cy="${size * 0.38}" r="${size * 0.15}" fill="#22c55e"/>
    <circle cx="${size * 0.5}" cy="${size * 0.3}" r="${size * 0.12}" fill="#4ade80"/>
    <rect x="${size * 0.44}" y="${size * 0.55}" width="${size * 0.12}" height="${size * 0.25}" rx="${size * 0.03}" fill="#15803d"/>
  </svg>`;

  const outputPath = path.join(__dirname, '..', 'public', 'icons', `icon-${size}.png`);
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outputPath);
  console.log(`Generated ${outputPath}`);
}

(async () => {
  await generateIcon(192);
  await generateIcon(512);
  console.log('Done');
})();
