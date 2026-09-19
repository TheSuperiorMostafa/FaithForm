"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  PencilLine,
  RefreshCw,
  Smartphone,
} from "lucide-react";

import {
  publishRecordingAction,
  retryRecordingAction,
} from "@/app/dashboard/live-streaming/recording-actions";
import { RecordingPlayer } from "@/components/live-streaming/recording-player";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatClock } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import type { StaffRecording } from "@/lib/stream/recording-publication";
import { cn } from "@/lib/utils";

const AUDIENCE: Record<RecordingSettings["defaultVisibility"], string> = {
  public: "everyone",
  followers: "people who follow your church",
  members: "members",
};

/**
 * What happens after "End Livestream".
 *
 * One screen that moves on by itself — Preparing → Recording ready →
 * Published — with one obvious action at each step. The church may leave at
 * any point; the recording keeps being prepared without this page.
 */
export function PostLivePanel({
  recording,
  previewUrl,
  settings,
  isAdmin,
  onChanged,
}: {
  recording: StaffRecording;
  previewUrl: string | null;
  settings: RecordingSettings;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const phase = recording.phase.phase;
  const reviewHref = `/dashboard/live-streaming/recordings/${recording.id}`;

  const publish = () =>
    startTransition(async () => {
      const result = await publishRecordingAction({
        recordingId: recording.id,
        appVisibility: settings.defaultVisibility,
        website: settings.publishToWebsite,
        notifyMembers: settings.notifyOnPublish,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Published. It's now in the Faithful app.");
      onChanged();
    });

  const retry = () =>
    startTransition(async () => {
      const result = await retryRecordingAction(recording.id);
      if (!result.ok) toast.error(result.error);
      onChanged();
    });

  if (phase === "preparing" || phase === "recording") {
    return (
      <div className="flex flex-col items-center gap-4 px-2 py-10 text-center" role="status">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent">
          <Loader2 className="size-7 motion-safe:animate-spin" aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-2xl font-bold">Your livestream has ended</h2>
          <p className="text-base text-muted-foreground">
            FaithForm is preparing your recording. You can leave this page — it will be ready when you come back.
          </p>
        </div>
        <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-[ff-progress_1.6s_ease-in-out_infinite]" />
        </div>
        {recording.fullDurationSec ? (
          <p className="text-sm text-muted-foreground">
            {formatClock(recording.fullDurationSec)} recorded
          </p>
        ) : null}
      </div>
    );
  }

  if (phase === "needs_attention") {
    const nothing = recording.status === "failed" && recording.segmentCount === 0;
    return (
      <div className="flex flex-col gap-4 py-6" role="alert">
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-500/30 dark:bg-red-500/10">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-300" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-lg font-semibold">
              {nothing ? "Nothing was recorded" : "We couldn't prepare this recording"}
            </h2>
            <p className="text-sm text-red-900/80 dark:text-red-100/80">{recording.phase.detail}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!nothing && isAdmin ? (
            <Button onClick={retry} disabled={pending} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Try again
            </Button>
          ) : null}
          <Link href="/dashboard/support" className={buttonVariants({ variant: "outline" })}>
            Contact support
          </Link>
        </div>
      </div>
    );
  }

  const published = phase === "published";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-semibold",
            published ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
          )}
        >
          {published ? <CheckCircle2 className="size-4" aria-hidden /> : null}
          {published ? "Published" : "Recording ready"}
        </p>
        <h2 className="font-heading text-2xl font-bold leading-tight">{recording.title}</h2>
        <p className="text-sm text-muted-foreground">
          {recording.durationSec ? formatClock(recording.durationSec) : null}
          {recording.speaker ? ` · ${recording.speaker}` : ""}
          {recording.seriesName ? ` · ${recording.seriesName}` : ""}
        </p>
      </div>

      {previewUrl ? (
        <RecordingPlayer src={previewUrl} kind="hls" poster={recording.posterUrl} title={recording.title} />
      ) : null}

      {published ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {[
              recording.app.published ? "Members can watch it in the Faithful app, under Services" : null,
              recording.website.published ? "on your church website" : null,
            ]
              .filter(Boolean)
              .join(", and ")}
            .
          </p>
          <div className="flex flex-wrap gap-2">
            {recording.watchUrl ? (
              <a
                href={recording.watchUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ size: "lg" }), "gap-2")}
              >
                View on your website
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : null}
            <Link href={reviewHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}>
              <PencilLine className="size-4" aria-hidden />
              Edit details
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Visible in</span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="size-4" aria-hidden /> Faithful app ({AUDIENCE[settings.defaultVisibility]})
            </span>
            {settings.publishToWebsite ? (
              <span className="inline-flex items-center gap-1.5">
                <Globe className="size-4" aria-hidden /> Church website
              </span>
            ) : null}
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                onClick={publish}
                disabled={pending || !recording.canPublish}
                className="min-w-40 gap-2"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {pending ? "Publishing…" : "Publish"}
              </Button>
              <Link href={reviewHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}>
                <PencilLine className="size-4" aria-hidden />
                Edit details
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">A church admin can publish this recording.</p>
          )}
          {!recording.canPublish && recording.publishBlockedReason ? (
            <p className="text-sm text-muted-foreground">{recording.publishBlockedReason}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
