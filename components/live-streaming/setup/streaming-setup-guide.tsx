"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clapperboard,
  Loader2,
  MonitorPlay,
  RefreshCw,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { CopyBothButton, StreamTechnicalDetails, useStreamKey } from "@/components/live-streaming/encoder-setup-card";
import {
  STREAMING_TOOLS,
  type StreamingToolId,
} from "@/components/live-streaming/encoder-docs-card";
import {
  CONNECTED_ACCOUNTS_HREF,
  PlatformsCard,
  type PlatformPushState,
} from "@/components/live-streaming/platforms-card";
import { RecordingSettingsCard } from "@/components/live-streaming/setup/recording-settings-card";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button, buttonVariants } from "@/components/ui/button";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import { GO_LIVE_HREF } from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<StreamingToolId, React.ComponentType<{ className?: string }>> = {
  obs: MonitorPlay,
  atem: SlidersHorizontal,
  vmix: Clapperboard,
  browser: Camera,
  someone_else: Users,
};

const TOOL_KEY = "ff-streaming-tool";
const CHECK_EVERY_MS = 5000;

type Props = {
  ingestServerUrl: string;
  isAdmin: boolean;
  settings: RecordingSettings;
  series: Array<{ id: string; name: string }>;
  youtube: PlatformPushState;
  facebook: PlatformPushState;
};

/**
 * Set up streaming, in three steps a volunteer can follow without training:
 *
 *   1. What do you stream with?  → only that tool's steps, and Copy both
 *   2. Waiting for your video…   → Connected ✓ (live, from the status poll)
 *   3. After the service         → publish automatically, or review first
 *
 * The server address, the stream key and Replace stream key sit under
 * "Technical details"; pairing, encoder presets, embed code and destinations
 * are in the Advanced section below the steps.
 */
export function StreamingSetupGuide({ ingestServerUrl, isAdmin, settings, series, youtube, facebook }: Props) {
  const [tool, setTool] = useState<StreamingToolId | null>(null);
  const streamKey = useStreamKey();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TOOL_KEY) as StreamingToolId | null;
      if (saved && STREAMING_TOOLS.some((entry) => entry.id === saved)) setTool(saved);
    } catch {
      // No storage (private window): the choice just isn't remembered.
    }
  }, []);

  const choose = (id: StreamingToolId) => {
    setTool(id);
    try {
      window.localStorage.setItem(TOOL_KEY, id);
    } catch {
      // Ignore; see above.
    }
  };

  const chosen = STREAMING_TOOLS.find((entry) => entry.id === tool) ?? null;

  return (
    <ol className="flex flex-col gap-6">
      <Step number={1} title="What do you stream with?" description="Pick the one you use. We'll show just the steps for it.">
        <div role="radiogroup" aria-label="What do you stream with?" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STREAMING_TOOLS.map((entry) => {
            const Icon = TOOL_ICONS[entry.id];
            const selected = entry.id === tool;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(entry.id)}
                className={cn(
                  "flex min-h-20 items-center gap-4 rounded-2xl border-2 p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                  selected ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-accent/50",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-semibold">{entry.name}</span>
                  <span className="text-sm text-muted-foreground">{entry.blurb}</span>
                </span>
                {selected ? <CheckCircle2 className="ml-auto size-5 shrink-0 text-accent" aria-hidden /> : null}
              </button>
            );
          })}
        </div>

        {chosen ? (
          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-muted/30 p-5">
            <h3 className="font-heading text-lg font-semibold">{chosen.name}: three steps</h3>
            <ol className="flex flex-col gap-3">
              {chosen.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-base leading-relaxed">
                  <span
                    aria-hidden
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                  >
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {chosen.usesKey ? (
              <CopyBothButton ingestServerUrl={ingestServerUrl} streamKey={streamKey} isAdmin={isAdmin} />
            ) : (
              <Link href={GO_LIVE_HREF} className={cn(buttonVariants({ size: "lg" }), "w-fit")}>
                Open Go live
              </Link>
            )}
          </div>
        ) : null}

        <AdvancedSection title="Technical details" description="Server address and stream key, one at a time">
          <StreamTechnicalDetails ingestServerUrl={ingestServerUrl} isAdmin={isAdmin} streamKey={streamKey} />
        </AdvancedSection>
      </Step>

      <Step number={2} title="Check your video" description="Start streaming in your software. This turns to Connected on its own.">
        <VideoCheck />
      </Step>

      <Step number={3} title="After the service" description="Every service is recorded automatically. What should happen next?">
        <RecordingSettingsCard initial={settings} series={series} isAdmin={isAdmin} />
        <div className="flex flex-col gap-3">
          <h3 className="font-heading text-lg font-semibold">Also show on YouTube or Facebook</h3>
          <p className="text-[15px] text-muted-foreground">
            Connect them once and every service shows there too. Connecting happens in Settings.
          </p>
          <PlatformsCard isAdmin={isAdmin} youtube={youtube} facebook={facebook} variant="compact" />
          {isAdmin && youtube.connected && facebook.connected ? (
            <Link
              href={CONNECTED_ACCOUNTS_HREF}
              className="w-fit py-2 text-[15px] font-medium text-primary underline underline-offset-4 dark:text-accent"
            >
              Manage connected accounts
            </Link>
          ) : null}
        </div>
      </Step>
    </ol>
  );
}

function Step({
  number,
  title,
  description,
  children,
}: {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8 dark:shadow-none">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-foreground"
        >
          {number}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-bold">
            <span className="sr-only">Step {number}: </span>
            {title}
          </h2>
          <p className="text-base text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </li>
  );
}

/** Asks the same status endpoint the Go live tab uses, every few seconds. */
function VideoCheck() {
  const [state, setState] = useState<"checking" | "waiting" | "connected" | "unknown">("checking");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/stream/status", { cache: "no-store" });
      if (!res.ok) {
        setState("unknown");
        return;
      }
      const data = (await res.json()) as { overview?: { video?: { arriving?: boolean } } };
      setState(data.overview?.video?.arriving ? "connected" : "waiting");
    } catch {
      setState("unknown");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [check]);

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        {state === "connected" ? (
          <>
            <CheckCircle2 className="size-7 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
            <span className="flex flex-col">
              <span className="text-lg font-semibold text-emerald-700 dark:text-emerald-300">Connected ✓</span>
              <span className="text-[15px] text-muted-foreground">
                FaithForm is receiving your video. You&apos;re ready for Sunday.
              </span>
            </span>
          </>
        ) : state === "unknown" ? (
          <span className="flex flex-col">
            <span className="text-lg font-semibold">We couldn&apos;t check just now</span>
            <span className="text-[15px] text-muted-foreground">Check your internet connection, then try again.</span>
          </span>
        ) : (
          <>
            <Loader2 className="size-7 shrink-0 text-amber-600 motion-safe:animate-spin dark:text-amber-300" aria-hidden />
            <span className="flex flex-col">
              <span className="text-lg font-semibold">Waiting for your video…</span>
              <span className="text-[15px] text-muted-foreground">
                Press Start streaming in your software. This can take up to half a minute.
              </span>
            </span>
          </>
        )}
      </div>
      <Button type="button" variant="outline" onClick={() => void check()} disabled={busy} className="shrink-0 gap-2">
        <RefreshCw className={cn("size-4", busy && "motion-safe:animate-spin")} aria-hidden />
        Check again
      </Button>
    </div>
  );
}
