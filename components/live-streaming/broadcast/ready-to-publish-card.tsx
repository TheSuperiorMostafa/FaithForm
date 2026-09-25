"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Film } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  readyToPublishHeadline,
  recordingFilterHref,
  recordingHref,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

export type ReadyRecording = { id: string; title: string; recordedAt: string };

const LATER_KEY = "ff-live-ready-later";

function readLater(): string[] {
  try {
    const raw = window.sessionStorage.getItem(LATER_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeLater(ids: string[]) {
  try {
    window.sessionStorage.setItem(LATER_KEY, JSON.stringify(ids));
  } catch {
    // Private windows can refuse storage; "Later" then lasts until reload.
  }
}

/**
 * "1 recording ready to publish → Review & publish", on the Go live tab until
 * the recording is handled.
 *
 * Replaces the old twelve-hour post-live panel as the thing that reminds a
 * church on Monday. It is driven by server state (every recording in "Ready to
 * publish"), so it goes away only when the recording is published, taken
 * down or deleted. "Later" folds it to one line for this browser session —
 * never into nothing, and a new recording brings it back.
 */
export function ReadyToPublishCard({
  recordings,
  hideRecordingId,
  isAdmin,
}: {
  recordings: ReadyRecording[];
  /** Already on screen in the post-live panel; not listed twice. */
  hideRecordingId: string | null;
  isAdmin: boolean;
}) {
  const visible = useMemo(
    () => recordings.filter((recording) => recording.id !== hideRecordingId),
    [recordings, hideRecordingId],
  );
  const [later, setLater] = useState<string[]>([]);
  useEffect(() => setLater(readLater()), []);

  if (visible.length === 0) return null;

  const headline = readyToPublishHeadline(visible.length);
  const href = visible.length === 1 ? recordingHref(visible[0].id) : recordingFilterHref("needs-action");
  const action = isAdmin ? "Review & publish" : "Review";
  const folded = visible.every((recording) => later.includes(recording.id));

  if (folded) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50/60 px-5 py-3 dark:border-sky-500/30 dark:bg-sky-500/10">
        <p className="flex items-center gap-2 text-[15px] font-medium">
          <Film className="size-5 text-sky-700 dark:text-sky-300" aria-hidden />
          {headline}
        </p>
        <Link href={href} className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          {action}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    );
  }

  return (
    <section
      aria-label={headline}
      className="flex flex-col gap-4 rounded-3xl border border-sky-200 bg-sky-50/70 p-6 sm:flex-row sm:items-center sm:justify-between dark:border-sky-500/30 dark:bg-sky-500/10"
    >
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-sm dark:bg-sky-500/20 dark:text-sky-200"
        >
          <Film className="size-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 className="font-heading text-xl font-bold">{headline}</h2>
          <p className="truncate text-[15px] text-muted-foreground">
            {visible.length === 1
              ? `${visible[0].title}. Members can't watch it until it's published.`
              : `${visible
                  .slice(0, 2)
                  .map((recording) => recording.title)
                  .join(", ")}${visible.length > 2 ? ` and ${visible.length - 2} more` : ""}.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            const next = Array.from(new Set([...later, ...visible.map((recording) => recording.id)]));
            writeLater(next);
            setLater(next);
          }}
        >
          Later
        </Button>
        {/* Outline, not solid: Go live stays the page's one primary button. */}
        <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2 bg-card")}>
          {action}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
