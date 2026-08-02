"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Debounced autosave for the Website editor.
 *
 * Written to hold four properties that a naive `useEffect` + `setTimeout`
 * version quietly gets wrong:
 *
 * 1. **It never fires for data the user did not touch.** Opening a form — or
 *    reopening one — does not write the current values back over themselves.
 * 2. **Saves never overlap.** Requests can finish out of order, and two in
 *    flight at once means the older one can land last and undo the newer edit.
 *    One save runs at a time; an edit arriving mid-flight goes next.
 * 3. **Closing does not discard.** A debounced edit is flushed when the editor
 *    is disabled or unmounted, rather than having its timer quietly cleared.
 * 4. **A failed save does not lose the edit.** The value stays in component
 *    state and the next change resends it in full, so a validation error or a
 *    dropped connection is recoverable rather than silently discarded — and it
 *    does not spin retrying a value the server will always reject.
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<SaveResult>,
  options: { delay?: number; enabled?: boolean } = {},
): { status: AutosaveStatus; saveNow: () => void } {
  const { delay = 900, enabled = true } = options;

  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });

  const saveRef = useRef(save);
  saveRef.current = save;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  /**
   * The edit waiting to be written, captured when it was made rather than read
   * at save time. A flush therefore saves what the user actually edited, even
   * if the component's current value has since become something else (a closed
   * sermon editor, for instance, whose draft is already back to null).
   */
  const queued = useRef<{ value: T } | null>(null);

  /**
   * The last value the hook accepted as already-saved. A save is queued only
   * when the incoming value is a *different* object, which is what makes a
   * re-render — or React's development double-invoked effects — not count as
   * an edit. A "have I mounted yet" flag cannot do this: it is a ref, so it
   * survives the very teardown it is meant to detect.
   */
  const lastSeen = useRef(value);
  const wasEnabled = useRef(enabled);

  const run = useCallback(async () => {
    // Already saving: the finally block below picks the queued edit up.
    if (inFlight.current) return;

    const entry = queued.current;
    if (!entry) return;

    queued.current = null;
    inFlight.current = true;
    setStatus({ kind: "saving" });

    try {
      const result = await saveRef.current(entry.value);
      setStatus(
        result.ok ? { kind: "saved" } : { kind: "error", message: result.error },
      );
    } catch {
      setStatus({
        kind: "error",
        message: "That change could not be saved. It will retry as you keep editing.",
      });
    } finally {
      inFlight.current = false;
      // The rejected value is not requeued: it is still on screen in component
      // state, and the next edit resends the whole object. Requeueing it here
      // would retry a value the server just refused, forever.
      if (queued.current) void run();
    }
  }, []);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void run();
  }, [run]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (!enabled) {
      // Closing an editor is not a reason to throw away the last keystroke.
      if (wasEnabled.current) flush();
      wasEnabled.current = false;
      lastSeen.current = value;
      return;
    }

    if (!wasEnabled.current) {
      // Opening an editor is not an edit either.
      wasEnabled.current = true;
      lastSeen.current = value;
      return;
    }

    if (Object.is(value, lastSeen.current)) return;
    lastSeen.current = value;

    queued.current = { value };
    setStatus({ kind: "pending" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
  }, [value, delay, enabled, run, flush]);

  // Navigating away mid-debounce saves rather than drops.
  useEffect(() => () => flushRef.current(), []);

  // ...and a closing tab cannot be saved into, so warn instead.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (status.kind === "pending" || status.kind === "saving") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.kind]);

  return { status, saveNow: flush };
}
