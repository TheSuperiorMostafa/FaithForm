"use client";

import { useState } from "react";

/**
 * The one thing a projector or a tablet does before it can do anything: prove
 * a staff member set it up.
 *
 * Deliberately plain. It is typed once, by someone standing at a machine, often
 * with a remote or an on-screen keyboard, sometimes across a room. So: one
 * field, large text, no branding to load, and no way to get it wrong other than
 * getting the code wrong.
 *
 * Every failure reads the same. Wrong code, expired code, already-used code and
 * stopped-session are one message, because the alternative tells anyone typing
 * codes whether they were close.
 */
export function PairingForm({
  title,
  hint,
  endpoint,
  onPaired,
}: {
  title: string;
  hint: string;
  endpoint: string;
  onPaired: () => void;
}) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "working" | "failed" | "throttled">("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "working") return;
    setState("working");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (response.ok) {
        // The code is cleared from React state as well as from the field. It
        // is spent, and leaving it in a component's memory is one more place
        // it could be read from a debugger on an unattended machine.
        setCode("");
        onPaired();
        return;
      }

      setState(response.status === 429 ? "throttled" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-lg space-y-6 text-center">
        <h1 className="font-heading text-3xl font-semibold">{title}</h1>
        <p className="text-base text-slate-400">{hint}</p>

        <input
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
            if (state !== "working") setState("idle");
          }}
          // A pairing code is not a password: someone reads it aloud across a
          // room and types it on a screen they cannot see well. Masking it
          // would cause more re-entry than it prevents shoulder-surfing, and
          // the code is single-use and expires in five minutes anyway.
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={16}
          aria-label="Pairing code"
          placeholder="BCD-4G7J"
          className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5 text-center font-mono text-4xl uppercase tracking-[0.3em] outline-none focus:border-slate-400"
        />

        <button
          type="submit"
          disabled={state === "working" || code.trim().length === 0}
          className="w-full rounded-2xl bg-slate-100 px-6 py-4 text-lg font-semibold text-slate-950 disabled:opacity-40"
        >
          {state === "working" ? "Checking…" : "Connect"}
        </button>

        <p aria-live="polite" className="min-h-[1.5rem] text-base text-amber-300">
          {state === "failed" && "That code didn't work. Ask for a new one."}
          {state === "throttled" && "Too many tries. Wait a moment and try again."}
        </p>
      </form>
    </div>
  );
}
