/**
 * A small in-memory map whose entries expire.
 *
 * Per server instance and deliberately forgetful: for values that are cheap to
 * keep and costly to fetch on every request, where serving one a few seconds
 * stale is acceptable. Bounded in size; the oldest entry goes first.
 */

/** Bounded, so a flood of distinct keys cannot grow a server's memory. */
const MAX_ENTRIES = 1_000;

type Entry<T> = { value: T; expiresAt: number };

export class ExpiringCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      // Insertion order: the first key is the oldest.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
