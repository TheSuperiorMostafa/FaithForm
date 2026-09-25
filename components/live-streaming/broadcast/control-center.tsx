"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  HelpCircle,
  Loader2,
  MonitorUp,
  Pencil,
  Radio,
  Square,
  X,
} from "lucide-react";

import {
  endLiveBroadcastAction,
  goLiveBroadcast,
  renameLiveService,
} from "@/app/dashboard/live-streaming/actions";
import { LivePreview } from "@/components/live-streaming/broadcast/live-preview";
import { PostLivePanel } from "@/components/live-streaming/broadcast/post-live-panel";
import {
  ReadyToPublishCard,
  type ReadyRecording,
} from "@/components/live-streaming/broadcast/ready-to-publish-card";
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
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import type { BroadcastOverview } from "@/lib/stream/broadcast-overview";
import { formatClock, formatClockForSpeech, formatServiceTime } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import { MEMBER_APP } from "@/lib/stream/recording-status";
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
  /**
   * Recordings still waiting to be published, for the persistent "ready to
   * publish" card. It sits above the state card when nothing is on air, and
   * below it during a service so it never pushes End service out of reach.
   */
  readyRecordings: ReadyRecording[];
};

/** How often the screen asks the server what is true. */
const POLL_MS = 4000;

/** What a service is called when nothing is scheduled. */
export const DEFAULT_SERVICE_TITLE = "Sunday Service";

/** The Setup tab walks through connecting video, and checks it arrives. */
const SETUP_HREF = "/dashboard/live-streaming/setup";
const HELP_HREF = "/dashboard/support";

/**
 * The Sunday workflow as one big state card:
 *
 *   Ready → Waiting for video → Live → Processing → Ready to publish
 *
 * Everything shown comes from the server's status poll, which is derived from
 * the session, the relay's heartbeats and the segments FaithForm has
 * acknowledged. Closing this tab, refreshing it, or opening it on another
 * computer changes nothing: the next poll rebuilds exactly the same screen.
 *
 * Each state has one obvious action (Go live, End service, Publish) and
 * everything technical is folded away under "Technical details".
 */
export function BroadcastControlCenter({
  initialStatus,
  isAdmin,
  nextService,
  timeZone,
  settings,
  platforms,
  branding,
  readyRecordings,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, startTransition] = useTransition();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioSupported, setStudioSupported] = useState(false);
  const [title, setTitle] = useState(nextService?.title ?? DEFAULT_SERVICE_TITLE);
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

  // When the recording finishes preparing, the server-rendered "ready to
  // publish" card needs to learn about it too.
  const recordingPhase = overview.recording?.phase.phase ?? null;
  const lastRecordingPhase = useRef(recordingPhase);
  useEffect(() => {
    if (lastRecordingPhase.current === recordingPhase) return;
    lastRecordingPhase.current = recordingPhase;
    if (recordingPhase === "ready_to_publish" || recordingPhase === "published") router.refresh();
  }, [recordingPhase, router]);

  const goLive = () =>
    startTransition(async () => {
      const result = await goLiveBroadcast(
        nextService ? undefined : title.trim() || DEFAULT_SERVICE_TITLE,
        nextService?.id,
      );
      if (!result.ok) {
        toast.error(result.error ?? "We couldn't start the livestream. Please try again.");
        return;
      }
      await refresh();
    });

  const endLive = () =>
    startTransition(async () => {
      const wasWaiting = phase === "waiting_for_video";
      const result = await endLiveBroadcastAction();
      setConfirmEnd(false);
      if (!result.ok) {
        toast.error(result.error ?? "We couldn't end the livestream. Please try again.");
        await refresh();
        return;
      }
      toast.success(
        wasWaiting ? "Service cancelled. Nothing went out." : "Service ended. Your recording is being prepared.",
      );
      await refresh();
    });

  const renameLive = (nextTitle: string) =>
    startTransition(async () => {
      const result = await renameLiveService(nextTitle);
      if (!result.ok) {
        toast.error(result.error ?? "We couldn't rename the service. Please try again.");
        return;
      }
      const message = result.message ?? "Title updated everywhere.";
      if (message.includes("didn't accept")) toast.warning(message);
      else toast.success(message);
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

  const onAir = phase === "live" || phase === "waiting_for_video";
  const postLiveRecordingId = phase === "post_live" ? (overview.recording?.id ?? null) : null;
  const readyCard = (
    <ReadyToPublishCard recordings={readyRecordings} hideRecordingId={postLiveRecordingId} isAdmin={isAdmin} />
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="sr-only" aria-live="polite" role="status">
        {announcement}
      </p>

      {!onAir ? readyCard : null}

      <section
        aria-label="Your service"
        className={cn(
          "rounded-3xl border bg-card p-6 shadow-card sm:p-8 dark:shadow-none",
          phase === "live" ? "border-red-200 dark:border-red-500/30" : "border-border",
        )}
      >
        {phase === "live" ? (
          <LiveView
            overview={overview}
            status={status}
            studioStream={studio.outputStream}
            isAdmin={isAdmin}
            pending={pending}
            onEnd={() => setConfirmEnd(true)}
            onRename={renameLive}
          />
        ) : phase === "waiting_for_video" ? (
          <WaitingView
            overview={overview}
            studioStream={studio.outputStream}
            isAdmin={isAdmin}
            pending={pending}
            onCancel={() => setConfirmEnd(true)}
            onRename={renameLive}
          />
        ) : phase === "post_live" && overview.recording ? (
          <div className="flex flex-col gap-6">
            <PostLivePanel
              recording={overview.recording}
              previewUrl={overview.recordingPreviewUrl}
              settings={settings}
              isAdmin={isAdmin}
              onChanged={() => {
                void refresh();
                router.refresh();
              }}
            />
            {isAdmin ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <p className="text-[15px] text-muted-foreground">Ready for your next service?</p>
                <Button variant="outline" onClick={() => setDismissedPostLive(overview.recording?.id ?? null)}>
                  Prepare the next service
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <ReadyView
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

      {onAir ? readyCard : null}

      {isAdmin && studioSupported && phase !== "post_live" ? (
        <section className="rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
          <button
            type="button"
            onClick={() => setStudioOpen((open) => !open)}
            aria-expanded={studioOpen}
            className="flex min-h-16 w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-3">
              <MonitorUp className="size-5 text-accent" aria-hidden />
              <span className="flex flex-col">
                <span className="text-base font-semibold">Stream from this computer</span>
                <span className="text-sm text-muted-foreground">
                  No streaming software? Use this computer&apos;s camera or screen instead.
                </span>
              </span>
            </span>
            <ChevronDown
              className={cn(
                "size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                studioOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {studioOpen ? (
            <div className="flex flex-col gap-3 border-t border-border p-5">
              <p className="text-[15px] text-muted-foreground">
                Keep this tab open while you stream from it — this computer is the camera. Recording still happens
                automatically.
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
              {phase === "waiting_for_video" ? "Cancel this service?" : "End the service?"}
            </DialogTitle>
            <DialogDescription className="text-base">
              {phase === "waiting_for_video"
                ? "Nothing has gone out yet. You can go live again whenever you're ready."
                : "Your recording will be saved automatically and prepared for publishing."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmEnd(false)} disabled={pending}>
              {phase === "waiting_for_video" ? "Keep waiting" : "Stay live"}
            </Button>
            <Button
              onClick={endLive}
              disabled={pending}
              className="gap-2 bg-red-600 text-white hover:bg-red-700 hover:text-white"
            >
              {pending ? (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Square className="size-4" aria-hidden />
              )}
              {phase === "waiting_for_video" ? "Cancel service" : "End service"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready
// ---------------------------------------------------------------------------

function FactRow({
  label,
  value,
  state,
  hint,
}: {
  label: string;
  value: string;
  state: "ok" | "waiting" | "plain";
  hint?: React.ReactNode;
}) {
  const Icon = state === "ok" ? CheckCircle2 : state === "waiting" ? CircleDashed : null;
  return (
    <div className="flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <dt className="text-[15px] text-muted-foreground">{label}</dt>
      <dd className="flex flex-col gap-1 sm:items-end sm:text-right">
        <span
          className={cn(
            "inline-flex items-center gap-2 text-base font-semibold",
            state === "ok" && "text-emerald-700 dark:text-emerald-300",
            state === "waiting" && "text-amber-700 dark:text-amber-300",
          )}
        >
          {Icon ? <Icon className="size-5 shrink-0" aria-hidden /> : null}
          {value}
        </span>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

function ReadyView({
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
  const sharing = [platforms.youtube ? "YouTube" : null, platforms.facebook ? "Facebook" : null].filter(
    (name): name is string => Boolean(name),
  );
  const destinations = [
    overview.readiness.appReady ? `the ${MEMBER_APP}` : "your church's watch page",
    ...sharing,
  ];
  const showingIn =
    destinations.length === 1
      ? destinations[0]
      : `${destinations.slice(0, -1).join(", ")} and ${destinations[destinations.length - 1]}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <StatusBadge tone="ready" size="lg" className="w-fit">
          Ready
        </StatusBadge>

        {nextService ? (
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-3xl font-bold leading-tight">{nextService.title}</h2>
            <p className="text-base text-muted-foreground">{formatServiceTime(nextService.startsAt, timeZone)}</p>
          </div>
        ) : isAdmin ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="go-live-title" className="text-[15px]">
              Service name
            </Label>
            <Input
              id="go-live-title"
              value={title}
              onChange={(event) => onTitle(event.target.value)}
              maxLength={120}
              className="h-14 font-heading text-2xl font-bold"
            />
          </div>
        ) : (
          <h2 className="font-heading text-3xl font-bold leading-tight">No service scheduled</h2>
        )}

        <dl className="divide-y divide-border border-y border-border">
          <FactRow
            label="Video"
            value={videoReady ? "Connected" : "Not connected yet"}
            state={videoReady ? "ok" : "waiting"}
            hint={
              videoReady ? undefined : (
                <Link href={SETUP_HREF} className="font-medium text-primary underline underline-offset-4 dark:text-accent">
                  How to connect your video
                </Link>
              )
            }
          />
          <FactRow label="Recording" value="Automatic" state="ok" hint="Starts the moment you go live" />
          <FactRow label="Showing in" value={showingIn} state="plain" />
        </dl>

        {studioStream ? <LivePreview active={false} studioStream={studioStream} placeholder="" /> : null}
      </div>

      <div className="flex flex-col justify-center gap-3">
        {isAdmin ? (
          <>
            <Button
              size="lg"
              onClick={onGoLive}
              disabled={pending}
              className="min-h-16 w-full gap-3 text-xl"
            >
              {pending ? (
                <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden />
              ) : (
                <Radio className="size-6" aria-hidden />
              )}
              Go live
            </Button>
            <p className="text-center text-[15px] text-muted-foreground">
              {videoReady
                ? "Your video is connected. Press Go live when the service starts."
                : "You can press Go live before your video is connected. FaithForm goes live the moment it arrives."}
            </p>
          </>
        ) : (
          <p className="text-[15px] text-muted-foreground">Only church admins can go live.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waiting for video
// ---------------------------------------------------------------------------

function WaitingView({
  overview,
  studioStream,
  isAdmin,
  pending,
  onCancel,
  onRename,
}: {
  overview: BroadcastOverview;
  studioStream: MediaStream | null;
  isAdmin: boolean;
  pending: boolean;
  onCancel: () => void;
  onRename: (title: string) => void;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <StatusBadge tone="working" size="lg" className="w-fit">
          Waiting for video
        </StatusBadge>
        <LiveTitle
          current={overview.session?.title ?? DEFAULT_SERVICE_TITLE}
          canRename={isAdmin}
          pending={pending}
          onRename={onRename}
        />
        <div className="flex flex-col gap-2 text-base leading-relaxed">
          <p>FaithForm is ready and waiting for your video.</p>
          <p className="text-muted-foreground">
            Press <span className="font-semibold text-foreground">Start streaming</span> in your streaming software
            (OBS, ATEM or vMix). You&apos;ll go live automatically as soon as the video arrives, and recording starts
            on its own.
          </p>
          <Link
            href={SETUP_HREF}
            className="w-fit py-2 font-medium text-primary underline underline-offset-4 dark:text-accent"
          >
            Check your streaming setup
          </Link>
        </div>
        {studioStream ? <LivePreview active={false} studioStream={studioStream} placeholder="" /> : null}
      </div>
      <div className="flex flex-col justify-center gap-3">
        <span className="flex items-center justify-center gap-3 rounded-2xl bg-muted/50 px-4 py-5 text-base font-medium">
          <Loader2 className="size-5 text-amber-600 motion-safe:animate-spin dark:text-amber-300" aria-hidden />
          Waiting for your video…
        </span>
        {isAdmin ? (
          <Button variant="outline" size="lg" onClick={onCancel} disabled={pending} className="w-full gap-2">
            <X className="size-5" aria-hidden />
            Cancel service
          </Button>
        ) : null}
        <Link href={HELP_HREF} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "w-full gap-2")}>
          <HelpCircle className="size-5" aria-hidden />
          Get help
        </Link>
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
  onRename,
}: {
  overview: BroadcastOverview;
  status: ControlCenterStatus;
  studioStream: MediaStream | null;
  isAdmin: boolean;
  pending: boolean;
  onEnd: () => void;
  onRename: (title: string) => void;
}) {
  const elapsed = useElapsed(overview.session?.liveSince ?? overview.session?.startedAt ?? null);
  const [healthOpen, setHealthOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const lostVideo = !overview.video.arriving;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2.5 rounded-full bg-red-600 px-4 py-2 text-base font-bold uppercase tracking-wider text-white">
            <span className="size-3 rounded-full bg-white motion-safe:animate-pulse" aria-hidden />
            Live
          </span>
          <span
            className="font-heading text-4xl font-bold tabular-nums sm:text-5xl"
            aria-label={`Live for ${formatClockForSpeech(elapsed)}`}
          >
            {formatClock(elapsed)}
          </span>
        </div>
        <LiveTitle
          current={overview.session?.title ?? DEFAULT_SERVICE_TITLE}
          canRename={isAdmin}
          pending={pending}
          onRename={onRename}
        />
        <LivePreview active studioStream={studioStream} placeholder="Connecting to your live picture…" />
      </div>

      <div className="flex flex-col gap-5">
        <RecordingCard indicator={overview.recordingIndicator} />

        {lostVideo ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
            <div className="text-[15px]">
              <p className="font-semibold">The video signal dropped.</p>
              <p className="text-muted-foreground">
                FaithForm is waiting for your streaming software to reconnect. You&apos;re still live.
              </p>
            </div>
          </div>
        ) : null}

        {isAdmin ? (
          <Button
            size="lg"
            onClick={onEnd}
            disabled={pending}
            className="min-h-16 w-full gap-3 bg-red-600 text-xl text-white hover:bg-red-700 hover:text-white"
          >
            <Square className="size-5" aria-hidden />
            End service
          </Button>
        ) : null}

        <div className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          <Disclosure open={linksOpen} onToggle={() => setLinksOpen((open) => !open)} title="Where to watch">
            <StreamShareLinksPanel shareLinks={status.shareLinks} compact />
          </Disclosure>
          <Disclosure open={healthOpen} onToggle={() => setHealthOpen((open) => !open)} title="Technical details">
            <StreamHealth overview={overview} />
          </Disclosure>
        </div>
      </div>
    </div>
  );
}

/** The live service's title, with a labelled Rename that keeps the old title on Cancel. */
function LiveTitle({
  current,
  canRename,
  pending,
  onRename,
}: {
  current: string;
  canRename: boolean;
  pending: boolean;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-3xl font-bold leading-tight">{current}</h2>
        {canRename ? (
          <Button type="button" variant="ghost" onClick={() => setEditing(true)} disabled={pending} className="gap-2">
            <Pencil className="size-4" aria-hidden />
            Rename
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.trim()) return;
        onRename(draft.trim());
        setEditing(false);
      }}
    >
      <Label htmlFor="live-title" className="sr-only">
        Service name
      </Label>
      <Input
        id="live-title"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={100}
        autoFocus
        className="h-12 text-lg"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !draft.trim()}>
          Save name
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RecordingCard({ indicator }: { indicator: BroadcastOverview["recordingIndicator"] }) {
  const tone =
    indicator.state === "recording"
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
      : indicator.state === "attention"
        ? "border-orange-300 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10"
        : "border-border bg-muted/40";
  return (
    <div
      className={cn("flex items-start gap-3 rounded-2xl border p-4", tone)}
      role={indicator.state === "attention" ? "alert" : undefined}
    >
      {indicator.state === "recording" ? (
        <span className="relative mt-1.5 flex size-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex size-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
          <span className="relative inline-flex size-3 rounded-full bg-red-600" />
        </span>
      ) : indicator.state === "attention" ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 size-5 shrink-0 text-muted-foreground motion-safe:animate-spin" aria-hidden />
      )}
      <div className="flex flex-col gap-0.5">
        <p className="text-base font-semibold">{indicator.label}</p>
        <p className="text-[15px] text-muted-foreground">{indicator.detail}</p>
        {indicator.state === "attention" ? (
          <Link href={HELP_HREF} className="mt-1 text-[15px] font-medium underline underline-offset-4">
            Get help
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
        className="flex min-h-12 w-full items-center justify-between px-4 py-3 text-left text-[15px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
        <ChevronDown
          className={cn("size-5 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")}
          aria-hidden
        />
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
              "text-[15px]",
              note.tone === "good" && "text-emerald-700 dark:text-emerald-300",
              note.tone === "warn" && "text-amber-700 dark:text-amber-300",
              note.tone === "bad" && "text-red-700 dark:text-red-300",
            )}
          >
            {note.message}
          </li>
        ))}
      </ul>
      {!overview.readiness.appReady ? (
        <p className="text-sm text-muted-foreground">
          Live video in the {MEMBER_APP} isn&apos;t turned on for your church yet. Contact FaithForm support to turn it
          on.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Link href={SETUP_HREF} className={cn(buttonVariants({ variant: "link" }), "w-fit text-[15px]")}>
        Open Setup
      </Link>
    </div>
  );
}
