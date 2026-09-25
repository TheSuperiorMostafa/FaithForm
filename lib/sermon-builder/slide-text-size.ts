/**
 * Slide text sizing shared by the PowerPoint export and the in-browser
 * Present mode, so a verse is the same size on the wall either way. Pure and
 * browser-safe (no pptxgenjs here).
 */

/** A PowerPoint wide slide is 13.33in across: 960 points. */
export const SLIDE_WIDTH_PT = 960;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Calibrated for 12.33" × 5.7" body box; prefers larger text, then shrink-to-fit. */
export function pickBodyFontSize(text: string): number {
  const words = countWords(text);
  if (words <= 8) return 92;
  if (words <= 16) return 74;
  if (words <= 28) return 60;
  if (words <= 45) return 50;
  if (words <= 65) return 42;
  if (words <= 90) return 36;
  if (words <= 120) return 30;
  return 26;
}

/** Title slide sizes, as the export sets them. */
export const TITLE_FONT_PT = 44;
export function pickSubtitleFontSize(text: string): number {
  return text.length > 60 ? 16 : 22;
}
