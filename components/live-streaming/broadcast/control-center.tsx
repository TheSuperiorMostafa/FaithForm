"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  MonitorUp,
  Radio,
  Settings2,
  Square,
} from "lucide-react";

import {
  endLiveBroadcastAction,
  goLiveBroadcast,
} from "@/app/dashboard/live-streaming/actions";
import { LivePreview } from "@/components/live-streaming/broadcast/live-preview";
import { PostLivePanel } from "@/components/live-streaming/broadcast/post-live-panel";
import { StreamShareLinksPanel } from "@/components/live-streaming/stream-share-links-panel";
import { StudioSourceControls } from "@/components/live-streaming/studio-source-controls";
import {
  useStudioBroadcast,
  type StudioBranding,
} from "@/components/live-streaming/use-studio-broadcast";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { BroadcastOverview } from "@/lib/stream/broadcast-overview";
import { formatClock, formatClockForSpeech, formatServiceTime } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import type { StreamShareLinks } from "@/lib/stream/share-links";
import { isStudioSupported } from "@/lib/stream/studio-support";
import { cn } from "@/lib/utils";

export type ControlCenterStatus = {
  previewIngestActive: boolean;
  shareLinks: StreamShareLinks;
  overview: BroadcastOverview;
};

export type UpcomingService = {
  id: string;
  title: string;
  startsAt: string;
};

type Props = {
  initialStatus: ControlCenterStatus;
  isAdmin: boolean;
  nextService: UpcomingService | null;
  timeZone: string;
  settings: RecordingSettings;
  platforms: { youtube: boolean; facebook: boolean };
  branding: StudioBranding;
};

/** How often the screen asks the server what is true. */
const POLL_MS = 4000;

/**
 * The weekly workflow: Prepare → Go Live → (FaithForm records) → End → Publish.
 *
 * Everything it shows comes from the server's status poll, which is derived
 * from the session, the relay's heartbeats and the segments FaithForm has
 * acknowledged. Closing this tab, refreshing it, or opening it on another
 * computer changes nothing: the next poll rebuilds exactly the same screen.
 *
 * At every step there is one obvious action — Go Live, End Livestream, Publish
 * — and everything technical is folded away under Stream health.
 */
export function BroadcastControlCenter({
  initialStatus,
  isAdmin,
  nextService,
  timeZone,
  settings,
  platforms,
  branding,
}: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioSupported, setStudioSupported] = useState(false);
  const [title, setTitle] = useState(nextService?.title ?? "Live Service");
  const [dismissedPostLive, setDismissedPostLive] = useState<string | null>(null);
  const studio = useStudioBroadcast(branding);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/stream/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as ControlCenterStatus;
      if (data?.overview) setStatus(data);
    } catch {
      // The next poll will try again; the screen keeps what it last knew.
    }
  }, []);

  useEffect(() => {
    setStudioSupported(isStudioSupported());
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const overview = status.overview;
  const phase =
    overview.phase === "post_live" && dismissedPostLive === overview.recording?.id ? "idle" : overview.phase;

  const goLive = () =>
    startTransition(async () => {
      const result = await goLiveBroadcast(
        nextService ? undefined : title.trim() || "Live Service",
        nextService?.id,
      );
      if (!result.ok) {
        toast.error(result.error ?? "Could not go live.");
        return;
      }
      await refresh();
    });

  const endLive = () =>
    startTransition(async () => {
      const result = await endLiveBroadcastAction();
      setConfirmEnd(false);
      if (!result.ok) {
        toast.error(result.error ?? "Could not end the livestream.");
        await refresh();
        return;
      }
      toast.success("Livestream ended. Your recording is being prepared.");
      await refresh();
    });

  const announcement = useMemo(() => {
    switch (phase) {
      case "live":
        return `You are live. ${overview.recordingIndicator.label}.`;
      case "waiting_for_video":
        return "Waiting for your video.";
      case "post_live":
        return overview.recording?.phase.label ?? "";
      default:
        return "";
    }
  }, [phase, overview.recordingIndicator.label, overview.recording?.phase.label]);

  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>

      <section className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-8 dark:shadow-none">
        {phase === "live" ? (
          <LiveView
            overview={overview}
            status={status}
            studioStream={studio.outputStream}
            isAdmin={isAdmin}
            pending={pending}
            onEnd={() => setConfirmEnd(true)}
          />
        ) : phase === "waiting_for_video" ? (
          <WaitingView
            overview={overview}
            studioStream={studio.outputStream}
            isAdmin={isAdmin}
            pending={pending}
            onCancel={() => setConfirmEnd(true)}
          />
        ) : phase === "post_live" && overview.recording ? (
          <div className="flex flex-col gap-6">
            <PostLivePanel
              recording={overview.recording}
              previewUrl={overview.recordingPreviewUrl}
              settings={settings}
              isAdmin={isAdmin}
              onChanged={refresh}
            />
            {isAdmin ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">Ready for your next service?</p>
                <Button
                  variant="outline"
                  onClick={() => setDismissedPostLive(overview.recording?.id ?? null)}
                >
                  Prepare the next broadcast
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <PreLiveView
            overview={overview}
            nextService={nextService}
            timeZone={timeZone}
            title={title}
            onTitle={setTitle}
            studioStream={studio.outputStream}
            platforms={platforms}
            isAdmin={isAdmin}
            pending={pending}
            onGoLive={goLive}
          />
        )}
      </section>

      {isAdmin && studioSupported && phase !== "post_live" ? (
        <section className="rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
          <button
            type="button"
            onClick={() => setStudioOpen((open) => !open)}
            aria-expanded={studioOpen}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
          >
            <span className="flex items-center gap-3">
              <MonitorUp className="size-5 text-accent" aria-hidden />
              <span className="flex flex-col">
                <span className="font-semibold">Stream from this computer</span>
                <span className="text-sm text-muted-foreground">
                  No encoder? Use this computer&apos;s camera or screen instead.
                </span>
              </span>
            </span>
            <ChevronDown
              className={cn("size-5 text-muted-foreground transition-transform", studioOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {studioOpen ? (
            <div className="flex flex-col gap-3 border-t border-border p-5">
              <p className="text-sm text-muted-foreground">
                Keep this tab open while you stream from it — this computer is the camera. (Recording
                still happens on FaithForm&apos;s servers.)
              </p>
              <StudioSourceControls
                isLive={studio.isLive}
                layout={studio.layout}
                pipCorner={studio.pipCorner}
                publishing={studio.publishing}
                micLevel={studio.micLevel}
                hasLogo={Boolean(branding.logoUrl)}
                onStartStudio={() => void studio.startStudio()}
                onStopStudio={studio.stopStudio}
                onSwitchLayout={(layout) => void studio.switchLayout(layout)}
                onSetPipCorner={studio.setPipCorner}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <Dialog open={confirmEnd} onOpenChange={(open) => !pending && setConfirmEnd(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {phase === "waiting_for_video" ? "Cancel this broadcast?" : "End livestream?"}
            </DialogTitle>
            <DialogDescription>
              {phase === "waiting_for_video"
                ? "Nothing has gone out yet. You can go live again whenever you're ready."
                : "Your recording will be saved automatically and prepared for publishing."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEnd(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={endLive}
              disabled={pending}
              className="gap-2 bg-red-600 text-white hover:bg-red-700 hover:text-white"
            >
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Square className="size-4" aria-hidden />}
              {phase === "waiting_for_video" ? "Cancel broadcast" : "End Livestream"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Before
// ---------------------------------------------------------------------------

function ReadinessRow({
  label,
  value,
  state,
  hint,
}: {
  label: string;
  value: string;
  state: "ok" | "waiting" | "problem";
  hint?: React.ReactNode;
}) {
  const Icon = state === "ok" ? CheckCircle2 : state === "problem" ? AlertTriangle : CircleDashed;
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex flex-col items-end gap-0.5 text-right">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-semibold",
            state === "ok" && "text-emerald-700 dark:text-emerald-300",
            state === "waiting" && "text-amber-700 dark:text-amber-300",
            state === "problem" && "text-red-700 dark:text-red-300",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {value}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </li>
  );
}

function PreLiveView({
  overview,
  nextService,
  timeZone,
  title,
  onTitle,
  studioStream,
  platforms,
  isAdmin,
  pending,
  onGoLive,
}: {
  overview: BroadcastOverview;
  nextService: UpcomingService | null;
  timeZone: string;
  title: string;
  onTitle: (value: string) => void;
  studioStream: MediaStream | null;
  platforms: { youtube: boolean; facebook: boolean };
  isAdmin: boolean;
  pending: boolean;
  onGoLive: () => void;
}) {
  const videoReady = overview.video.arriving || Boolean(studioStream);
  const allReady = videoReady && overview.readiness.appReady;
  const sharing = [platforms.youtube ? "YouTube" : null, platforms.facebook ? "Facebook" : null].filter(Boolean);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {nextService ? "Next service" : "Ready when you are"}
          </p>
          {nextService ? (
            <>
              <h2 className="font-heading text-3xl font-bold leading-tight">{nextService.title}</h2>
              <p className="text-base text-muted-foreground">{formatServiceTime(nextService.startsAt, timeZone)}</p>
            </>
          ) : isAdmin ? (
            <label className="flex flex-col gap-1.5">
              <span className="sr-only">What are you streaming?</span>
              <Input
                value={title}
                onChange={(event) => onTitle(event.target.value)}
                maxLength={120}
                className="h-auto border-0 bg-transparent px-0 font-heading text-3xl font-bold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                aria-label="What are you streaming?"
              />
              <span className="text-sm text-muted-foreground">Name this broadcast, then go live.</span>
            </label>
          ) : (
            <h2 className="font-heading text-3xl font-bold">No service scheduled</h2>
          )}
        </div>
        <LivePreview
          active={false}
          studioStream={studioStream}
          placeholder={
            videoReady
              ? "Your video is connected. The preview appears here once you go live."
              : "Start your streaming software, and your video will connect here."
          }
        />
      </div>

      <div className="flex flex-col justify-between gap-6">
        <div className="flex flex-col gap-2">
          <p
            className={cn(
              "inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
              allReady
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
            )}
          >
            {allReady ? <CheckCircle2 className="size-4" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
            {allReady ? "Ready to stream" : "Almost ready"}
          </p>
          <ul className="divide-y divide-border">
            <ReadinessRow
              label="Video source"
              value={videoReady ? "Connected" : "Not connected yet"}
              state={videoReady ? "ok" : "waiting"}
              hint={
                videoReady ? undefined : (
                  <Link href="/dashboard/live-streaming/setup" className="underline underline-offset-2">
                    How to connect
                  </Link>
                )
              }
            />
            <ReadinessRow label="Recording" value="Automatic" state="ok" hint="Starts the moment you go live" />
            <ReadinessRow
              label="Faithful app"
              value={overview.readiness.appReady ? "Ready" : "Not set up"}
              state={overview.readiness.appReady ? "ok" : "problem"}
              hint={overview.readiness.appReady ? "Members can watch live" : "Contact FaithForm support"}
            />
            {sharing.length > 0 ? (
              <ReadinessRow label="Also sharing to" value={sharing.join(" and ")} state="ok" />
            ) : null}
          </ul>
        </div>

        {isAdmin ? (
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={onGoLive} disabled={pending} className="h-14 gap-2 text-lg">
              {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Radio className="size-5" aria-hidden />}
              Go Live
            </Button>
            {!videoReady ? (
              <p className="text-center text-xs text-muted-foreground">
                You can go live now — FaithForm starts the moment your video arrives.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Only church admins can go live.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

function WaitingView({
  overview,
  studioStream,
  isAdmin,
  pending,
  onCancel,
}: {
  overview: BroadcastOverview;
  studioStream: MediaStream | null;
  isAdmin: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            Waiting for your video
          </p>
          <h2 className="font-heading text-3xl font-bold leading-tight">
            {overview.session?.title ?? "Live Service"}
          </h2>
        </div>
        <LivePreview
          active={false}
          studioStream={studioStream}
          placeholder="Start streaming from OBS, your ATEM or your encoder. You'll go live automatically as soon as video arrives."
        />
      </div>
      <div className="flex flex-col justify-between gap-6">
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p className="text-base text-foreground">FaithForm isn&apos;t receiving video yet.</p>
          <p>Check that your streaming software is running and set up with your stream key.</p>
          <p>Recording starts automatically as soon as your video arrives.</p>
          <Link href="/dashboard/live-streaming/setup" className="font-medium text-primary underline underline-offset-4 dark:text-accent">
            View setup
          </Link>
        </div>
        {isAdmin ? (
          <Button variant="outline" size="lg" onClick={onCancel} disabled={pending}>
            Cancel broadcast
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

function useElapsed(since: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return since ? Math.max(0, (now - Date.parse(since)) / 1000) : 0;
}

function LiveView({
  overview,
  status,
  studioStream,
  isAdmin,
  pending,
  onEnd,
}: {
  overview: BroadcastOverview;
  status: ControlCenterStatus;
  studioStream: MediaStream | null;
  isAdmin: boolean;
  pending: boolean;
  onEnd: () => void;
}) {
  const elapsed = useElapsed(overview.session?.liveSince ?? overview.session?.startedAt ?? null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const indicator = overview.recordingIndicator;
  const lostVideo = !overview.video.arriving;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-sm font-bold uppercase tracking-wider text-white">
            <span className="size-2.5 rounded-full bg-white motion-safe:animate-pulse" aria-hidden />
            Live
          </span>
          <span
            className="font-heading text-4xl font-bold tabular-nums sm:text-5xl"
            aria-label={`Live for ${formatClockForSpeech(elapsed)}`}
          >
            {formatClock(elapsed)}
          </span>
        </div>
        <h2 className="font-heading text-2xl font-bold leading-tight">{overview.session?.title ?? "Live Service"}</h2>
        <LivePreview active studioStream={studioStream} placeholder="Connecting to your live picture…" />
      </div>

      <div className="flex flex-col gap-5">
        <RecordingCard indicator={indicator} />

        {lostVideo ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10" role="alert">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
            <div className="text-sm">
              <p className="font-semibold">The video signal disconnected.</p>
              <p className="text-muted-foreground">FaithForm is waiting for your encoder to reconnect. You&apos;re still live.</p>
            </div>
          </div>
        ) : null}

        {isAdmin ? (
          <Button
            size="lg"
            onClick={onEnd}
            disabled={pending}
            className="h-14 gap-2 bg-red-600 text-lg text-white hover:bg-red-700 hover:text-white"
          >
            <Square className="size-5" aria-hidden />
            End Livestream
          </Button>
        ) : null}

        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          <Disclosure open={linksOpen} onToggle={() => setLinksOpen((open) => !open)} title="Where to watch">
            <StreamShareLinksPanel shareLinks={status.shareLinks} compact />
          </Disclosure>
          <Disclosure open={healthOpen} onToggle={() => setHealthOpen((open) => !open)} title="Stream health">
            <StreamHealth overview={overview} />
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

function RecordingCard({ indicator }: { indicator: BroadcastOverview["recordingIndicator"] }) {
  const tone =
    indicator.state === "recording"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
      : indicator.state === "attention"
        ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10"
        : "border-border bg-muted/40";
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border p-4", tone)} role={indicator.state === "attention" ? "alert" : undefined}>
      {indicator.state === "recording" ? (
        <span className="relative mt-1 flex size-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-3 rounded-full bg-red-600" />
        </span>
      ) : indicator.state === "attention" ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600 dark:text-red-300" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 size-5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
      )}
      <div className="flex flex-col gap-0.5">
        <p className="font-semibold">{indicator.label}</p>
        <p className="text-sm text-muted-foreground">{indicator.detail}</p>
        {indicator.state === "attention" ? (
          <Link href="/dashboard/support" className="mt-1 text-sm font-medium underline underline-offset-4">
            Contact support
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold"
      >
        {title}
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function StreamHealth({ overview }: { overview: BroadcastOverview }) {
  const stats = overview.video.stats;
  const rows: Array<[string, string]> = stats
    ? [
        ["Connection", overview.video.arriving ? "Receiving" : "Disconnected"],
        ["Bitrate", stats.bitrateKbps ? `${(stats.bitrateKbps / 1000).toFixed(1)} Mbps` : "—"],
        ["Resolution", stats.resolution ?? "—"],
        ["Frame rate", stats.fps ? `${Math.round(stats.fps)} fps` : "—"],
        ["Video", stats.videoCodec ?? "—"],
        ["Audio", stats.audioCodec ?? "—"],
        ["Reconnects", String(stats.reconnects)],
        ["Recorder", stats.recorderRunning ? `Running${stats.recorderVersion ? ` (v${stats.recorderVersion})` : ""}` : "Not running"],
        ["Waiting to save", `${stats.pendingUploads} segment${stats.pendingUploads === 1 ? "" : "s"}`],
        ["Last update", stats.lastHeartbeatAt ? new Date(stats.lastHeartbeatAt).toLocaleTimeString() : "—"],
      ]
    : [];
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {overview.video.health.map((note) => (
          <li
            key={note.message}
            className={cn(
              "text-sm",
              note.tone === "good" && "text-emerald-700 dark:text-emerald-300",
              note.tone === "warn" && "text-amber-700 dark:text-amber-300",
              note.tone === "bad" && "text-red-700 dark:text-red-300",
            )}
          >
            {note.message}
          </li>
        ))}
      </ul>
      {rows.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Link
        href="/dashboard/live-streaming/setup"
        className={cn(buttonVariants({ variant: "link" }), "h-auto w-fit gap-1 text-sm")}
      >
        <Settings2 className="size-4" aria-hidden />
        Stream setup
      </Link>
    </div>
  );
}
