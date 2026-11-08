"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  Camera,
  Clapperboard,
  CheckCircle2,
  Download,
  MonitorPlay,
  SlidersHorizontal,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { setEncoderAutoGoLive } from "@/app/dashboard/live-streaming/actions";
import { CopyBothButton, StreamTechnicalDetails, useStreamKey } from "@/components/live-streaming/encoder-setup-card";
import {
  atemSettingsDownloadUrl,
  STREAMING_TOOLS,
  STREAMING_TOOL_KEY,
  type StreamingToolId,
} from "@/components/live-streaming/encoder-docs-card";
import {
  CONNECTED_ACCOUNTS_HREF,
  PlatformsCard,
  type PlatformPushState,
} from "@/components/live-streaming/platforms-card";
import { RecordingSettingsCard } from "@/components/live-streaming/setup/recording-settings-card";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import { GO_LIVE_HREF } from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<StreamingToolId, React.ComponentType<{ className?: string }>> = {
  obs: MonitorPlay,
  atem: SlidersHorizontal,
  vmix: Clapperboard,
  other: Video,
  browser: Camera,
  someone_else: Users,
};

type Props = {
  ingestServerUrl: string;
  autoGoLive: boolean;
  isAdmin: boolean;
  appEnabled: boolean;
  settings: RecordingSettings;
  series: Array<{ id: string; name: string }>;
  youtube: PlatformPushState;
  facebook: PlatformPushState;
};

export function StreamingSetupGuide({
  ingestServerUrl,
  autoGoLive,
  isAdmin,
  appEnabled,
  settings,
  series,
  youtube,
  facebook,
}: Props) {
  const [tool, setTool] = useState<StreamingToolId | null>(null);
  const streamKey = useStreamKey();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STREAMING_TOOL_KEY) as StreamingToolId | null;
      if (saved && STREAMING_TOOLS.some((entry) => entry.id === saved)) setTool(saved);
    } catch {
      // No storage (private window): the choice just isn't remembered.
    }
  }, []);

  const choose = (id: StreamingToolId) => {
    setTool(id);
    try {
      window.localStorage.setItem(STREAMING_TOOL_KEY, id);
    } catch {
      // Ignore; see above.
    }
  };

  const chosen = STREAMING_TOOLS.find((entry) => entry.id === tool) ?? null;

  return (
    <ol className="flex flex-col gap-6">
      <Step number={1} title="What do you stream with?" description="Connect your equipment once. Then start each service from the equipment you already use.">
        <div role="radiogroup" aria-label="What do you stream with?" className="choice-grid choice-grid-3">
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
            {chosen.id === "atem" ? (
              <p className="text-[15px] text-muted-foreground">
                Using the original ATEM Mini? Connect it to your computer by USB and choose OBS Studio or vMix above.
              </p>
            ) : null}
            {chosen.usesKey ? (
              <div className="flex flex-wrap items-center gap-3">
                {chosen.id === "atem" ? (
                  <a
                    href={atemSettingsDownloadUrl(ingestServerUrl)}
                    download="FaithForm-ATEM.xml"
                    className={buttonVariants({ size: "lg" })}
                  >
                    <Download className="size-5" aria-hidden />
                    Download ATEM settings
                  </a>
                ) : null}
                <CopyBothButton
                  key={chosen.id}
                  ingestServerUrl={ingestServerUrl}
                  streamKey={streamKey}
                  isAdmin={isAdmin}
                  keyOnly={chosen.id === "atem"}
                />
              </div>
            ) : (
              <Link
                href={chosen.id === "browser" ? `${GO_LIVE_HREF}?source=computer` : GO_LIVE_HREF}
                className={cn(buttonVariants({ size: "lg" }), "w-fit")}
              >
                {chosen.id === "browser" ? "Go live from this computer" : "Open Go live"}
              </Link>
            )}
          </div>
        ) : null}

        <AdvancedSection title="Technical details" description="Server address and stream key, one at a time">
          <StreamTechnicalDetails ingestServerUrl={ingestServerUrl} isAdmin={isAdmin} streamKey={streamKey} />
        </AdvancedSection>
        <EncoderAutoGoLive initial={autoGoLive} isAdmin={isAdmin} />
      </Step>

      <Step number={2} title="After the service" description="Every service is recorded automatically. What should happen next?">
        <RecordingSettingsCard initial={settings} series={series} isAdmin={isAdmin} appEnabled={appEnabled} />
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

function EncoderAutoGoLive({ initial, isAdmin }: { initial: boolean; isAdmin: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  const save = (next: boolean) => {
    startTransition(async () => {
      const fallback = "We couldn't save how your stream starts. Please try again.";
      try {
        const result = await setEncoderAutoGoLive(next);
        if (!result.ok) {
          toast.error(result.error || fallback);
          return;
        }
        setEnabled(next);
        toast.success(next
          ? "Your next service will go live when FaithForm receives video from your equipment."
          : "Your next service will wait for you to press Go live in FaithForm.");
      } catch {
        toast.error(fallback);
      }
    });
  };

  return (
    <div className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-border p-5">
      <div className="flex flex-col gap-1">
        <Label htmlFor="encoder-auto-go-live" className="text-base font-semibold">
          Go live from your equipment
        </Label>
        <p id="encoder-auto-go-live-hint" className="text-[15px] text-muted-foreground">
          When on, pressing Start Streaming or On Air makes your service public as soon as video reaches FaithForm.
          Leave it off to check your video privately on the Go live tab.
        </p>
      </div>
      <Switch
        id="encoder-auto-go-live"
        aria-describedby="encoder-auto-go-live-hint"
        checked={enabled}
        disabled={!isAdmin || pending}
        onCheckedChange={save}
      />
    </div>
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
