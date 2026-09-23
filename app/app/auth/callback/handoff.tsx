"use client";

import { useEffect, useState } from "react";

import { readAppCallback, type AppCallbackHandoff } from "@/lib/auth/app-confirm-link";

/**
 * Hands the confirmation on to the app, and says something true when it can't.
 *
 * Why this is client-side at all: a provider reports failures in the URL
 * *fragment*, and a fragment never reaches a server. Reading the location here
 * is the only way this page can tell an expired link from a fresh one.
 *
 * There is no way to detect whether the app actually opened — a browser does
 * not report it either way — so the page does not pretend to. It tries once,
 * waits, and then shows the manual route. A person whose app did open has
 * already left and will never see it.
 */

/** Long enough for the OS hand-off to happen, short enough not to feel stuck. */
const FALLBACK_DELAY_MS = 2_000;

export function AppConfirmHandoff() {
  const [handoff, setHandoff] = useState<AppCallbackHandoff | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    const result = readAppCallback(window.location.search, window.location.hash);
    setHandoff(result);

    if (!result.link) {
      setShowFallback(true);
      return;
    }

    // `assign`, not `replace`: the back button should return here rather than
    // to the provider's verify URL, which is spent and would fail on a reload.
    window.location.assign(result.link);
    const timer = window.setTimeout(() => setShowFallback(true), FALLBACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The first paint, before the effect has read the location. Deliberately not
  // an error or an empty card: on a fast hand-off this is the only frame the
  // person sees, and it should read as progress.
  if (!handoff) return <Panel title="Confirming your email…" />;

  if (!showFallback) {
    return <Panel title="Confirming your email…" body="Opening FaithForm…" />;
  }

  if (handoff.kind === "failure") {
    return (
      <Panel
        title="This link didn't work"
        body="It may have expired or already been used. Open FaithForm, sign in with your email and password, and tap Resend on the confirmation screen if it asks."
        action={{ href: handoff.link, label: "Open FaithForm" }}
      />
    );
  }

  if (handoff.kind === "nothing") {
    return (
      <Panel
        title="Open FaithForm to finish"
        body="This link didn't carry anything the app could use — it was most likely opened once already. Open FaithForm and sign in with your email and password."
      />
    );
  }

  return (
    <Panel
      title="Your email is confirmed"
      body="If FaithForm didn't come to the front, open it from your home screen and sign in — your account is ready."
      action={{ href: handoff.link, label: "Open FaithForm" }}
    />
  );
}

function Panel({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="space-y-5 text-center">
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
        {body && <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>}
      </div>
      {action && (
        <a
          href={action.href}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
