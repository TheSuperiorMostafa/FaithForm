import { describeSaveFailure, GIVE_UP_MESSAGE } from "./save-failure";

export type SaveResult = { ok: true } | { ok: false; error: string };
export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "retrying"; message: string }
  | { kind: "error"; message: string };

export type DraftBackup<T> = { capture: (value: T) => () => void; clear: () => void };
type Entry<T> = { value: T; acknowledge?: () => void };

/** One writer per editor. Keep rejected edits available for an explicit retry. */
export class AutosaveQueue<T> {
  private pending: Entry<T> | null = null;
  private failed: Entry<T> | null = null;
  private running: Promise<SaveResult> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private active = true;

  constructor(
    private readonly save: (value: T) => Promise<SaveResult>,
    private readonly onStatus: (status: AutosaveStatus) => void,
    private readonly retryDelays = [2_000, 5_000, 15_000, 30_000],
    private readonly backup?: DraftBackup<T>,
  ) {}

  get hasUnsavedChanges(): boolean {
    return Boolean(this.pending || this.failed || this.running);
  }

  resume() { this.active = true; }

  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private status(status: AutosaveStatus) {
    if (this.active) this.onStatus(status);
  }

  enqueue(value: T, delay: number) {
    this.pending = { value, acknowledge: this.backup?.capture(value) };
    this.failed = null;
    this.attempts = 0;
    this.cancelTimer();
    this.status({ kind: "pending" });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  /** Adopt a server reset/undo without treating it as a new manual edit. */
  adoptSaved() {
    this.cancelTimer();
    this.pending = null;
    this.failed = null;
    this.attempts = 0;
    this.backup?.clear();
    this.status({ kind: "saved" });
  }

  /** Await every in-flight/newer edit. An explicit retry includes rejected data. */
  async flush(): Promise<SaveResult> {
    this.cancelTimer();
    if (!this.pending && this.failed) {
      this.pending = this.failed;
      this.failed = null;
      this.attempts = 0;
    }
    while (this.running || this.pending) {
      if (!this.active) return { ok: false, error: "Your change is kept in this tab. Return to the editor to restore it." };
      const result = await (this.running ?? this.run());
      // run() starts newer edits immediately, but a network retry retains its
      // backoff. A caller can now keep the editor open and show the failure.
      if (!result.ok && !this.running) return result;
    }
    return { ok: true };
  }

  stop() {
    this.active = false;
    this.cancelTimer();
    // Links flush before leaving. Browser history cannot be cancelled, so its
    // unsaved revision stays in the per-tab backup for explicit recovery. Do
    // not start a late write after this church/editor is no longer on screen.
  }

  private run(): Promise<SaveResult> {
    if (this.running) return this.running;
    const entry = this.pending;
    if (!entry) return Promise.resolve({ ok: true });
    this.pending = null;
    this.status({ kind: "saving" });
    let retryScheduled = false;

    this.running = (async (): Promise<SaveResult> => {
      // Start after assigning running, including when save throws synchronously.
      await Promise.resolve();
      try {
        if (!this.active) {
          this.pending ??= entry;
          return { ok: false, error: "Your change is kept in this tab. Return to the editor to restore it." };
        }
        const result = await this.save(entry.value);
        this.attempts = 0;
        if (result.ok) entry.acknowledge?.();
        if (!result.ok && !this.pending) this.failed = entry;
        this.status(result.ok
          ? { kind: "saved" }
          : { kind: "error", message: result.error });
        return result;
      } catch (error) {
        console.error("[autosave] save request failed:", error);
        const failure = describeSaveFailure(error);
        if (this.pending) {
          this.status({ kind: "retrying", message: failure.message });
        } else if (failure.retry && this.active && this.attempts < this.retryDelays.length) {
          const delay = this.retryDelays[this.attempts++];
          this.pending = entry;
          retryScheduled = true;
          this.status({ kind: "retrying", message: failure.message });
          this.cancelTimer();
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.run();
          }, delay);
        } else {
          this.failed = entry;
          this.status({ kind: "error", message: failure.retry ? GIVE_UP_MESSAGE : failure.message });
        }
        return { ok: false, error: failure.message };
      } finally {
        this.running = null;
        if (this.pending && !retryScheduled && this.active) {
          this.cancelTimer();
          void this.run();
        }
      }
    })();
    return this.running;
  }
}
