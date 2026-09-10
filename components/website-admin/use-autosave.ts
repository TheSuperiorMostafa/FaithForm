"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  describeSaveFailure,
  GIVE_UP_MESSAGE,
} from "@/components/website-admin/save-failure";

/** How long to wait before each resend of an edit whose request failed. */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

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
 *    state and the next change resends it in full, so a validation error is
 *    recoverable rather than silently discarded, and it does not spin
 *    retrying a value the server will always reject. A request that failed
 *    before the server could answer at all (a dropped connection, a cold
 *    start that fell over) is different: it is resent on its own, with
 *    backoff, because the edit that caused it may be the last one. A new
 *    photo is exactly that kind of edit.
 */

export type SaveResult = { ok: true } | { ok: false; error: string };

export type AutosaveStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved" }
  /** Not saved yet, and another attempt is already scheduled. */
  | { kind: "retrying"; message: string }
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

  /** Resends of the current edit so far. A new edit starts the count again. */
  const attempts = useRef(0);

  /**
   * The unmount flush still gets its one attempt, but nothing is scheduled
   * after the editor is gone: a resend landing minutes later, from a page
   * nobody is looking at, could overwrite whatever was edited since.
   */
  const mounted = useRef(true);

  const run = useCallback(async () => {
    // Already saving: the finally block below picks the queued edit up.
    if (inFlight.current) return;

    const entry = queued.current;
    if (!entry) return;

    queued.current = null;
    inFlight.current = true;
    setStatus({ kind: "saving" });

    let retryScheduled = false;

    try {
      const result = await saveRef.current(entry.value);
      attempts.current = 0;
      // A value the server refused is not requeued: it is still on screen in
      // component state, and the next edit resends the whole object.
      // Requeueing it here would retry a value the server just refused, forever.
      setStatus(
        result.ok ? { kind: "saved" } : { kind: "error", message: result.error },
      );
    } catch (error) {
      // Left in the console on purpose: this is the one place the real reason
      // is visible when someone reports that a save failed.
      console.error("[autosave] save request failed:", error);

      const failure = describeSaveFailure(error);

      if (queued.current) {
        // A newer edit is already waiting and carries this one inside it.
        // Sending that is the retry.
        setStatus({ kind: "retrying", message: failure.message });
      } else if (
        failure.retry &&
        mounted.current &&
        attempts.current < RETRY_DELAYS_MS.length
      ) {
        const delay = RETRY_DELAYS_MS[attempts.current] ?? 30_000;
        attempts.current += 1;
        queued.current = entry;
        retryScheduled = true;
        setStatus({ kind: "retrying", message: failure.message });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          void run();
        }, delay);
      } else {
        attempts.current = 0;
        setStatus({
          kind: "error",
          message: failure.retry ? GIVE_UP_MESSAGE : failure.message,
        });
      }
    } finally {
      inFlight.current = false;
      if (queued.current && !retryScheduled) void run();
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
    attempts.current = 0;
    setStatus({ kind: "pending" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
  }, [value, delay, enabled, run, flush]);

  // Navigating away mid-debounce saves rather than drops.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flushRef.current();
    };
  }, []);

  // Coming back online is the moment a waiting retry can work, so send it now
  // rather than at the end of its backoff.
  useEffect(() => {
    const retryNow = () => {
      if (queued.current) flushRef.current();
    };
    window.addEventListener("online", retryNow);
    return () => window.removeEventListener("online", retryNow);
  }, []);

  // ...and a closing tab cannot be saved into, so warn instead.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        status.kind === "pending" ||
        status.kind === "saving" ||
        status.kind === "retrying"
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status.kind]);

  return { status, saveNow: flush };
}
