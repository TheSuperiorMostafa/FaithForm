"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SaveState = "idle" | "saving" | "saved" | "error";

type SaveResult = { ok: boolean; error?: string };

const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/**
 * One autosaved field. Saves a moment after typing stops, at once on blur, and
 * on unmount if anything is still pending (the panel remounts per item, so a
 * half-typed note is saved to the item it was typed on). While the field is
 * not being edited it follows the database, so another planner's change shows.
 */
export function useAutosavedField<T>(
  external: T,
  save: (value: T) => Promise<SaveResult>,
  options: { delay?: number; onError?: (message: string) => void; onSaved?: (value: T) => void } = {},
) {
  const { delay = 700 } = options;
  const [value, setValue] = useState(external);
  const [state, setState] = useState<SaveState>("idle");
  const saved = useRef(external);
  const focused = useRef(false);
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => Promise<void> } | null>(null);
  const opts = useRef(options);
  opts.current = options;

  const runNow = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    void p.run();
  }, []);

  useEffect(() => {
    if (focused.current || pending.current) return;
    if (!same(external, saved.current)) {
      saved.current = external;
      setValue(external);
    }
  }, [external]);

  useEffect(() => () => runNow(), [runNow]);

  const schedule = (next: T, wait: number) => {
    setValue(next);
    if (pending.current) clearTimeout(pending.current.timer);
    const saveFn = save;
    const run = async () => {
      if (same(next, saved.current)) return;
      setState("saving");
      const result = await saveFn(next);
      if (result.ok) {
        saved.current = next;
        setState("saved");
        opts.current.onSaved?.(next);
      } else {
        setState("error");
        opts.current.onError?.(result.error ?? "We couldn't save that.");
      }
    };
    const timer = setTimeout(() => {
      pending.current = null;
      void run();
    }, wait);
    pending.current = { timer, run };
  };

  return {
    value,
    state,
    /** Typing: save after a pause. */
    onChange: (next: T) => schedule(next, delay),
    /** A choice (select, stepper): save right away. */
    commit: (next: T) => {
      schedule(next, 0);
      runNow();
    },
    focusProps: {
      onFocus: () => {
        focused.current = true;
      },
      onBlur: () => {
        focused.current = false;
        runNow();
      },
    },
  };
}

/** The panel's overall state from its fields: saving wins, then error, then saved. */
export function combineSaveStates(states: SaveState[]): SaveState {
  if (states.includes("saving")) return "saving";
  if (states.includes("error")) return "error";
  if (states.includes("saved")) return "saved";
  return "idle";
}

type ChangeEvent = { table: string; updatedBy: string | null };

/**
 * Tells the editor when this plan changes in the database, through Supabase
 * Realtime (RLS applies, so only staff with access hear anything). Calls are
 * debounced: a drag that writes one row and bumps the plan is one refresh.
 */
export function usePlanRealtime(planId: string, onChange: (events: ChangeEvent[]) => void): void {
  const handler = useRef(onChange);
  handler.current = onChange;

  useEffect(() => {
    const supabase = createClient();
    let pending: ChangeEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const push = (table: string) => (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) ?? {};
      pending.push({ table, updatedBy: (row.updated_by as string | null | undefined) ?? null });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = pending;
        pending = [];
        handler.current(batch);
      }, 400);
    };

    // A unique topic per mount: React's dev double-mount would otherwise let
    // the first cleanup remove the channel the second mount is using.
    const channel = supabase.channel(`service-plan:${planId}:${crypto.randomUUID()}`);
    // plan_attendance and plan_item_attachments join the publication in 0176.
    for (const table of [
      "plan_items",
      "plan_notes",
      "plan_item_leaders",
      "plan_times",
      "plan_attendance",
      "plan_item_attachments",
    ]) {
      channel.on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table, filter: `plan_id=eq.${planId}` },
        push(table),
      );
    }
    channel.on(
      "postgres_changes" as never,
      { event: "UPDATE", schema: "public", table: "plans", filter: `id=eq.${planId}` },
      push("plans"),
    );

    // Join only once the signed-in session is loaded. Joining first sends the
    // publishable key as the token, Realtime treats the socket as anonymous,
    // and RLS then filters out every change while the channel still reports
    // SUBSCRIBED.
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      channel.subscribe();
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [planId]);
}
