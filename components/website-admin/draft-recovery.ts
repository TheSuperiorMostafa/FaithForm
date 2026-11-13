export type WebsiteRecoveryScope = { userId: string; churchId: string };
export type RecoveredDraft<T> = { value: T; savedAt: number };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Envelope<T> = RecoveredDraft<T> & { version: 1; revision: string; key: string };

const invalidations = new Map<string, number>();
export function draftRecoveryVersion(key: string): number { return invalidations.get(key) ?? 0; }

const removals = new Map<string, Set<() => void>>();
let sequence = 0;

export function websiteRecoveryKey(scope: WebsiteRecoveryScope, editor: string): string {
  return `faithform:website-draft:v1:${JSON.stringify([scope.userId, scope.churchId, editor])}`;
}

export function isRecoveryRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function recoveryHasStrings(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecoveryRecord(value) && keys.every(key => typeof value[key] === "string");
}

/** Per-tab backup. A response may acknowledge only the revision it saved. */
export class DraftRecoveryStore<T> {
  constructor(
    private readonly storage: StorageLike | null,
    readonly key: string,
    private readonly onUnavailable: () => void = () => {},
  ) {}

  read(validate: (value: unknown) => value is T): RecoveredDraft<T> | null {
    try {
      if (!this.storage) { this.onUnavailable(); return null; }
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      const entry: unknown = JSON.parse(raw);
      if (!isRecoveryRecord(entry) || entry.version !== 1 || entry.key !== this.key || typeof entry.revision !== "string" || typeof entry.savedAt !== "number" || !validate(entry.value)) return null;
      return { value: entry.value, savedAt: entry.savedAt };
    } catch {
      this.onUnavailable();
      return null;
    }
  }

  capture(value: T): () => void {
    const revision = `${Date.now()}:${++sequence}`;
    try {
      if (!this.storage) this.onUnavailable();
      else this.storage.setItem(this.key, JSON.stringify({ version: 1, key: this.key, revision, value, savedAt: Date.now() } satisfies Envelope<T>));
    } catch {
      this.onUnavailable();
    }
    return () => this.acknowledge(revision);
  }

  private acknowledge(revision: string) {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const entry: unknown = JSON.parse(raw);
      if (isRecoveryRecord(entry) && entry.key === this.key && entry.revision === revision) this.clear(false);
    } catch { this.onUnavailable(); }
  }

  clear(invalidatePendingUploads = true) {
    if (invalidatePendingUploads) invalidations.set(this.key, draftRecoveryVersion(this.key) + 1);
    try { this.storage?.removeItem(this.key); }
    catch { this.onUnavailable(); }
    removals.get(this.key)?.forEach(listener => listener());
  }

  subscribeToRemoval(listener: () => void): () => void {
    const listeners = removals.get(this.key) ?? new Set<() => void>();
    listeners.add(listener);
    removals.set(this.key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) removals.delete(this.key);
    };
  }
}
