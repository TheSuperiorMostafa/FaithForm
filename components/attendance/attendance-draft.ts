/**
 * The Sunday count keeps a draft in this browser, so leaving the page (a phone
 * call, a closed tab, a dead battery) never loses the names already marked.
 *
 * Storage can be missing, full or blocked (private windows, strict settings),
 * so every read and write is wrapped and simply does nothing when it fails.
 * The draft is removed as soon as the Sunday is saved.
 *
 * Deliberately dependency-free: it is imported by client components.
 */

export type AttendanceDraftMode = "names" | "number";

export type AttendanceDraft = {
  version: 1;
  mode: AttendanceDraftMode;
  /** Only people someone actually marked; everyone else is "not marked". */
  statuses: Record<string, "present" | "absent">;
  headcount: string;
  notes: string;
  savedAt: number;
};

const PREFIX = "faithform:attendance-draft:";
/** A draft older than this is stale, not helpful. */
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 21;

export function draftKey(serviceDate: string, editing = false): string {
  return `${PREFIX}${serviceDate}${editing ? ":edit" : ""}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDraft(value: unknown): value is AttendanceDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<AttendanceDraft>;
  return (
    draft.version === 1 &&
    (draft.mode === "names" || draft.mode === "number") &&
    typeof draft.statuses === "object" &&
    draft.statuses !== null &&
    typeof draft.headcount === "string" &&
    typeof draft.notes === "string" &&
    typeof draft.savedAt === "number"
  );
}

export function parseDraft(raw: string | null, now = Date.now()): AttendanceDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isDraft(value)) return null;
    if (now - value.savedAt > MAX_AGE_MS) return null;
    const statuses: Record<string, "present" | "absent"> = {};
    for (const [id, status] of Object.entries(value.statuses)) {
      if (status === "present" || status === "absent") statuses[id] = status;
    }
    return { ...value, statuses };
  } catch {
    return null;
  }
}

export function readDraft(key: string): AttendanceDraft | null {
  try {
    const store = storage();
    if (!store) return null;
    const draft = parseDraft(store.getItem(key));
    if (!draft) store.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, draft: Omit<AttendanceDraft, "version" | "savedAt">): void {
  try {
    storage()?.setItem(key, JSON.stringify({ ...draft, version: 1, savedAt: Date.now() }));
  } catch {
    // Full or blocked storage: the page still works, it just can't remember.
  }
}

export function clearDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

/** True when the draft holds anything worth keeping. */
export function draftHasWork(draft: Pick<AttendanceDraft, "statuses" | "headcount" | "notes">): boolean {
  return (
    Object.keys(draft.statuses).length > 0 ||
    draft.headcount.trim().length > 0 ||
    draft.notes.trim().length > 0
  );
}
