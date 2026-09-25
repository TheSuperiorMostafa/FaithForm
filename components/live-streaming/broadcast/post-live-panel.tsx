"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ExternalLink,
  Globe,
  Loader2,
  PencilLine,
  RefreshCw,
  Send,
  Smartphone,
} from "lucide-react";

import {
  publishRecordingAction,
  retryRecordingAction,
} from "@/app/dashboard/live-streaming/recording-actions";
import { RecordingPlayer } from "@/components/live-streaming/recording-player";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatClock } from "@/lib/stream/format";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import type { StaffRecording } from "@/lib/stream/recording-publication";
import {
  MEMBER_APP,
  publishedWhereSentence,
  recordingHref,
  recordingTone,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

const AUDIENCE: Record<RecordingSettings["defaultVisibility"], string> = {
  public: "everyone",
  followers: "people who follow your church",
  members: "members",
};

/**
 * What happens after "End service", inside the Go live state card.
 *
 * One screen that moves on by itself — Processing → Ready to publish →
 * Published — with one obvious action at each step. The church may leave at
 * any point; the recording keeps being prepared without this page, and the
 * "ready to publish" card on the Go live tab keeps pointing at it until it is
 * handled.
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
  const reviewHref = recordingHref(recording.id);

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
      toast.success(`“${recording.title}” is published. Members see it in the ${MEMBER_APP} under Services.`);
      onChanged();
    });

  const retry = () =>
    startTransition(async () => {
      const result = await retryRecordingAction(recording.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Trying again. We'll show the recording here when it's ready.");
      onChanged();
    });

  if (phase === "preparing" || phase === "recording") {
    return (
      <div className="flex flex-col items-center gap-5 px-2 py-10 text-center" role="status">
        <StatusBadge tone="working" size="lg">
          Processing
        </StatusBadge>
        <div className="flex max-w-lg flex-col gap-2">
          <h2 className="font-heading text-3xl font-bold">Service ended</h2>
          <p className="text-base leading-relaxed text-muted-foreground">
            Your recording is being prepared. We&apos;ll show it here when it&apos;s ready to publish. You can leave
            this page.
          </p>
        </div>
        <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-[ff-progress_1.6s_ease-in-out_infinite]" />
        </div>
        {recording.fullDurationSec ? (
          <p className="text-[15px] text-muted-foreground">{formatClock(recording.fullDurationSec)} recorded</p>
        ) : null}
      </div>
    );
  }

  if (phase === "needs_attention") {
    const nothing = recording.status === "failed" && recording.segmentCount === 0;
    return (
      <div className="flex flex-col gap-5 py-4" role="alert">
        <StatusBadge tone="attention" size="lg" className="w-fit">
          Problem
        </StatusBadge>
        <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-5 dark:border-orange-500/30 dark:bg-orange-500/10">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-orange-600 dark:text-orange-300" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold">
              {nothing ? "Nothing was recorded" : "We couldn't prepare this recording"}
            </h2>
            <p className="text-[15px]">{recording.phase.detail}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!nothing && isAdmin ? (
            <Button onClick={retry} disabled={pending} className="gap-2">
              {pending ? (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              Try again
            </Button>
          ) : null}
          <Link href="/dashboard/support" className={buttonVariants({ variant: "outline" })}>
            Get help
          </Link>
        </div>
      </div>
    );
  }

  const published = phase === "published";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <StatusBadge tone={recordingTone(phase)} size="lg" className="w-fit">
          {recording.phase.label}
        </StatusBadge>
        <h2 className="font-heading text-3xl font-bold leading-tight">{recording.title}</h2>
        <p className="text-[15px] text-muted-foreground">
          {recording.durationSec ? formatClock(recording.durationSec) : null}
          {recording.speaker ? ` · ${recording.speaker}` : ""}
          {recording.seriesName ? ` · ${recording.seriesName}` : ""}
        </p>
      </div>

      {previewUrl ? (
        <RecordingPlayer src={previewUrl} kind="hls" poster={recording.posterUrl} title={recording.title} />
      ) : null}

      {published ? (
        <div className="flex flex-col gap-4">
          <p className="text-base">
            {publishedWhereSentence({ app: recording.app.published, website: recording.website.published })}
          </p>
          <div className="flex flex-wrap gap-2">
            {recording.watchUrl ? (
              <a
                href={recording.watchUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px] text-muted-foreground">
            <span className="font-medium text-foreground">Publishing puts it in</span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="size-4" aria-hidden /> the {MEMBER_APP} ({AUDIENCE[settings.defaultVisibility]})
            </span>
            {settings.publishToWebsite ? (
              <span className="inline-flex items-center gap-1.5">
                <Globe className="size-4" aria-hidden /> your church website
              </span>
            ) : null}
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                onClick={publish}
                disabled={pending || !recording.canPublish}
                className="min-w-48 gap-2"
              >
                {pending ? (
                  <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {pending ? "Publishing…" : "Publish to the app"}
              </Button>
              <Link href={reviewHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}>
                <PencilLine className="size-4" aria-hidden />
                Review first
              </Link>
            </div>
          ) : (
            <p className="text-[15px] text-muted-foreground">A church admin can publish this recording.</p>
          )}
          {!recording.canPublish && recording.publishBlockedReason ? (
            <p className="text-[15px] text-muted-foreground">{recording.publishBlockedReason}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
