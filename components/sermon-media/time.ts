/**
 * Times on the recording's untrimmed timeline, shown and typed as h:mm:ss.
 * Pure helpers shared by the sermon media panel and the clip editor.
 */

/** 75 → "1:15", 3725 → "1:02:05". Fractions are dropped; negatives clamp to 0. */
export function formatTime(totalSec: number): string {
  const safe = Number.isFinite(totalSec) ? Math.max(0, Math.floor(totalSec)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${ss}`;
  return `${minutes}:${ss}`;
}

/** A length in words: 45 → "45 seconds", 92 → "1 min 32 s", 3725 → "1 h 2 min". */
export function formatLength(totalSec: number): string {
  const safe = Number.isFinite(totalSec) ? Math.max(0, Math.round(totalSec)) : 0;
  if (safe < 60) return `${safe} second${safe === 1 ? "" : "s"}`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/**
 * Reads what someone typed: "1:02:05", "62:05", "45", "45.5", " 1:2:3 ".
 * Minutes and seconds after the first part must be below 60. Returns null when
 * it can't be read, so the field can say so instead of guessing.
 */
export function parseTime(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;
  const numbers: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!.trim();
    const isLast = index === parts.length - 1;
    const pattern = isLast ? /^\d+(\.\d+)?$/ : /^\d+$/;
    if (!pattern.test(part)) return null;
    numbers.push(Number(part));
  }
  // Every part after the first is a minutes or seconds field.
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index]! >= 60) return null;
  }
  const total = numbers.reduce((sum, value) => sum * 60 + value, 0);
  return Number.isFinite(total) ? total : null;
}

/** Keeps a value inside [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
