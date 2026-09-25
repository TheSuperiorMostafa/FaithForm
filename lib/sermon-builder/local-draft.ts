/**
 * An unsaved sermon kept in this browser, so closing the tab or following a
 * link before "Save sermon" does not lose the work.
 *
 * Only a convenience: storage can be missing, full, or blocked (private
 * windows), so every access is wrapped and a failure simply means no draft.
 * Nothing here is sent anywhere.
 */

export type LocalSermonDraft = {
  title: string;
  sermonDate: string;
  translation: string;
  themeId: string;
  passages: Array<{
    ref: string;
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
  }>;
  /** The passage picker's current selection, which is included on save. */
  current: {
    book: string;
    chapter: number | "";
    verseStart: number | "";
    verseEnd: number | "";
  } | null;
  savedAt: string;
};

const PREFIX = "faithform:sermon-draft:";

/** One draft per sermon being edited, and one for a new sermon. */
export function localDraftKey(sermonId?: string | null): string {
  return `${PREFIX}${sermonId ?? "new"}`;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
const isCountOrBlank = (v: unknown): v is number | "" => v === "" || isCount(v);

/** Validates whatever came out of storage; anything unexpected is dropped. */
export function parseLocalDraft(raw: string | null): LocalSermonDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (
    !isString(d.title) ||
    !isString(d.sermonDate) ||
    !isString(d.translation) ||
    !isString(d.themeId) ||
    !isString(d.savedAt) ||
    !Array.isArray(d.passages)
  ) {
    return null;
  }

  const passages = d.passages.filter(
    (p): p is LocalSermonDraft["passages"][number] =>
      Boolean(p) &&
      typeof p === "object" &&
      isString((p as Record<string, unknown>).ref) &&
      isString((p as Record<string, unknown>).book) &&
      isCount((p as Record<string, unknown>).chapter) &&
      isCount((p as Record<string, unknown>).verseStart) &&
      isCount((p as Record<string, unknown>).verseEnd),
  );

  let current: LocalSermonDraft["current"] = null;
  const c = d.current as Record<string, unknown> | null | undefined;
  if (
    c &&
    typeof c === "object" &&
    isString(c.book) &&
    isCountOrBlank(c.chapter) &&
    isCountOrBlank(c.verseStart) &&
    isCountOrBlank(c.verseEnd)
  ) {
    current = {
      book: c.book,
      chapter: c.chapter,
      verseStart: c.verseStart,
      verseEnd: c.verseEnd,
    };
  }

  return {
    title: d.title,
    sermonDate: d.sermonDate,
    translation: d.translation,
    themeId: d.themeId,
    passages,
    current,
    savedAt: d.savedAt,
  };
}

/** True when the draft holds anything worth offering back. */
export function hasDraftContent(draft: Pick<LocalSermonDraft, "title" | "passages" | "current">): boolean {
  return Boolean(
    draft.title.trim() || draft.passages.length > 0 || (draft.current?.book && draft.current.chapter),
  );
}

export function readLocalDraft(key: string): LocalSermonDraft | null {
  try {
    return parseLocalDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Returns false when the browser would not keep it. */
export function writeLocalDraft(key: string, draft: LocalSermonDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to clear, or storage is blocked: either way there is no draft.
  }
}
