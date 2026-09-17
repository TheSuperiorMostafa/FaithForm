/**
 * Where a person got to in a recording, kept on their device and nowhere else.
 *
 * ## This is a deliberate constraint, not a missing feature
 *
 * `docs/faithform/P9_NATIVE_MEDIA_EXPERIENCE.md` decided that resume positions
 * are device-local, and said of a server endpoint for them: "there is no server
 * endpoint for it, and none should be added." The native apps honour that with
 * the Keychain and EncryptedSharedPreferences. This is the web's half of the
 * same promise.
 *
 * The consequence is real and should be stated plainly rather than worked
 * around: "Continue watching" does not follow anyone between devices. Watch
 * half a sermon on a laptop and the phone will not know. That is the price of
 * a church platform holding no record of what any individual watched, and it
 * was judged worth paying.
 *
 * ## Why localStorage and not a cookie
 *
 * A cookie is sent to the server on every request, which would hand us exactly
 * the history this file exists to avoid holding — passively, in access logs,
 * without anyone deciding to collect it.
 */

const STORAGE_PREFIX = "faithform.media.progress";
/** Bumped when the record shape changes, so old entries are ignored not parsed. */
const STORAGE_VERSION = 1;

/** Keeps the store small enough to parse synchronously on every page load. */
const MAX_ENTRIES = 40;
/** Older than this and offering to resume is a worse guess than starting over. */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 90;

export type LocalProgressEntry = {
  itemId: string;
  positionSec: number;
  durationSec: number | null;
  updatedAt: number;
};

/**
 * Partitioned by church, for the same reason the native caches are partitioned
 * by authorization version: a shared family laptop used for two churches must
 * not show one congregation's half-watched sermons under the other's name.
 */
function storageKey(churchId: string): string {
  return `${STORAGE_PREFIX}.v${STORAGE_VERSION}.${churchId}`;
}

function available(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    // Safari in private mode, and any browser with storage blocked, throws on
    // access rather than returning null. Resume is a convenience; it must never
    // be the reason a page fails to render.
    return false;
  }
}

function isEntry(value: unknown): value is LocalProgressEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.itemId === "string" &&
    entry.itemId.length > 0 &&
    typeof entry.positionSec === "number" &&
    Number.isFinite(entry.positionSec) &&
    typeof entry.updatedAt === "number" &&
    Number.isFinite(entry.updatedAt) &&
    (entry.durationSec === null || typeof entry.durationSec === "number")
  );
}

export function readProgress(churchId: string): LocalProgressEntry[] {
  if (!available()) return [];

  try {
    const raw = window.localStorage.getItem(storageKey(churchId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cutoff = Date.now() - MAX_AGE_MS;
    // Validated per entry rather than trusted: this crosses a boundary the app
    // does not control — anything can write to localStorage, including an
    // older version of this code.
    return parsed
      .filter(isEntry)
      .filter((entry) => entry.updatedAt >= cutoff)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * Records a position. Best effort — a full or blocked store must never
 * interrupt playback.
 */
export function writeProgress(
  churchId: string,
  entry: { itemId: string; positionSec: number; durationSec: number | null },
): void {
  if (!available()) return;
  if (!Number.isFinite(entry.positionSec) || entry.positionSec < 0) return;

  try {
    const existing = readProgress(churchId).filter((row) => row.itemId !== entry.itemId);
    const next: LocalProgressEntry[] = [
      {
        itemId: entry.itemId,
        positionSec: Math.round(entry.positionSec),
        durationSec: entry.durationSec,
        updatedAt: Date.now(),
      },
      ...existing,
    ].slice(0, MAX_ENTRIES);

    window.localStorage.setItem(storageKey(churchId), JSON.stringify(next));
  } catch {
    // Ignored on purpose. See above.
  }
}

export function forgetProgress(churchId: string, itemId: string): void {
  if (!available()) return;
  try {
    const next = readProgress(churchId).filter((row) => row.itemId !== itemId);
    window.localStorage.setItem(storageKey(churchId), JSON.stringify(next));
  } catch {
    // Ignored on purpose.
  }
}

/** Clears everything for one church. Wired to a visible control, never silent. */
export function clearProgress(churchId: string): void {
  if (!available()) return;
  try {
    window.localStorage.removeItem(storageKey(churchId));
  } catch {
    // Ignored on purpose.
  }
}
