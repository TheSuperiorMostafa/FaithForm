import sharp from "sharp";
import { normalizeHexColor } from "@/lib/giving/branding";

export type AppThemePalette = {
  primary: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
};

export type ChurchAppTheme = {
  light: AppThemePalette;
  dark: AppThemePalette;
};

const LIGHT_BACKGROUND = "#F8F7F4";
const DARK_BACKGROUND = "#0F1117";
const LIGHT_CONTENT = "#002D5F";
const DARK_CONTENT = "#F0EDE6";

type RGB = { r: number; g: number; b: number };

function parseHex(value: string): RGB {
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: RGB): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function mix(color: string, target: string, amount: number): string {
  const from = parseHex(color);
  const to = parseHex(target);
  return toHex({
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  });
}

function luminance(color: string): number {
  const channels = Object.values(parseHex(color)).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(color: string, background: string, target: string, ratio: number): string {
  if (contrastRatio(color, background) >= ratio) return color;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(color, target, step / 20);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return target;
}

function bestContent(background: string): string {
  return contrastRatio(LIGHT_CONTENT, background) >= contrastRatio("#FFFFFF", background)
    ? LIGHT_CONTENT
    : "#FFFFFF";
}

/**
 * Turns church-selected colors into semantic mobile roles. Brand colors are
 * adjusted only when needed for WCAG contrast; status colors stay canonical.
 */
export function createChurchAppTheme(
  primaryValue: string | null | undefined,
  accentValue: string | null | undefined,
): ChurchAppTheme | null {
  const primary = normalizeHexColor(primaryValue);
  const accent = normalizeHexColor(accentValue);
  if (!primary && !accent) return null;

  const requestedPrimary = primary ?? LIGHT_CONTENT;
  const requestedAccent = accent ?? primary ?? "#C5A059";
  const lightPrimary = ensureContrast(requestedPrimary, LIGHT_BACKGROUND, "#000000", 4.5);
  const darkPrimary = ensureContrast(requestedPrimary, DARK_BACKGROUND, "#FFFFFF", 4.5);
  const darkAccent = ensureContrast(requestedAccent, DARK_BACKGROUND, "#FFFFFF", 3);

  return {
    light: {
      primary: lightPrimary,
      accent: requestedAccent,
      accentSoft: mix(requestedAccent, LIGHT_BACKGROUND, 0.72),
      onAccent: bestContent(requestedAccent),
    },
    dark: {
      primary: darkPrimary,
      accent: darkAccent,
      accentSoft: mix(darkAccent, DARK_CONTENT, 0.28),
      onAccent: bestContent(darkAccent),
    },
  };
}

/** Extracts two useful, distinct swatches from uploaded logo pixels. */
export async function extractLogoTheme(buffer: Buffer): Promise<{
  primaryColor: string;
  accentColor: string;
} | null> {
  const { data, info } = await sharp(buffer)
    .resize(72, 72, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { color: RGB; score: number }>();
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index + 3] < 96) continue;
    const color = { r: data[index], g: data[index + 1], b: data[index + 2] };
    const max = Math.max(color.r, color.g, color.b);
    const min = Math.min(color.r, color.g, color.b);
    if (max > 245 || max < 22 || max - min < 18) continue;
    const quantized = {
      r: Math.round(color.r / 32) * 32,
      g: Math.round(color.g / 32) * 32,
      b: Math.round(color.b / 32) * 32,
    };
    const key = `${quantized.r},${quantized.g},${quantized.b}`;
    const saturation = (max - min) / Math.max(max, 1);
    const existing = buckets.get(key);
    buckets.set(key, {
      color,
      score: (existing?.score ?? 0) + 1 + saturation * 2,
    });
  }

  const ranked = [...buckets.values()].sort((a, b) => b.score - a.score);
  if (!ranked[0]) return null;
  const primaryColor = toHex(ranked[0].color);
  const accent = ranked.find(({ color }) => {
    const candidate = toHex(color);
    const a = parseHex(primaryColor);
    const b = parseHex(candidate);
    return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b) >= 90;
  });
  return {
    primaryColor,
    accentColor: accent ? toHex(accent.color) : mix(primaryColor, "#FFFFFF", 0.38),
  };
}
