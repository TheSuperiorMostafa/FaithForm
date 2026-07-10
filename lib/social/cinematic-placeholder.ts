import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;

/**
 * Synthetic moody background when AI/stock photos are unavailable.
 * Warm chiaroscuro tones so the composite overlay still reads as cinematic.
 */
export async function generateCinematicPlaceholderBackground(
  primaryColor: string,
  accentColor: string,
): Promise<ArrayBuffer> {
  const primary = primaryColor || "#1a1208";
  const accent = accentColor || "#c9a227";

  const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="warmGlow" cx="78%" cy="32%" r="55%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="${primary}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#0a0604" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="base" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080604"/>
      <stop offset="35%" stop-color="${primary}"/>
      <stop offset="72%" stop-color="#1f140c"/>
      <stop offset="100%" stop-color="#2a1810"/>
    </linearGradient>
    <linearGradient id="vignette" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.72"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.05"/>
    </linearGradient>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="linear" slope="0.035"/>
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#base)"/>
  <rect width="100%" height="100%" fill="url(#warmGlow)"/>
  <rect width="100%" height="100%" fill="url(#vignette)"/>
  <rect width="100%" height="100%" filter="url(#grain)"/>
</svg>`;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
}
