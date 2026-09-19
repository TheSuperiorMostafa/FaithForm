/**
 * Display helpers for the livestream and recording screens. Pure, so they
 * render identically on the server and in the browser.
 */

/** "54:21" or "1:04:18". */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
}

/** "54 min", "1 hr 4 min". For lists, where a clock reads as a timestamp. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Spoken form for screen readers: "54 minutes 21 seconds". */
export function formatClockForSpeech(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s || parts.length === 0) parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Parses "3:42", "1:04:18" or "222" into seconds. Null when it is not a time. */
export function parseClock(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d{1,2}$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return null;
  return numbers.reduce((total, part) => total * 60 + part, 0);
}

/** "Sunday, September 20 · 10:00 AM" in the church's zone. */
export function formatServiceTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const options = timeZone ? { timeZone } : {};
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", ...options }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...options }).format(date);
  return `${day} · ${time}`;
}
