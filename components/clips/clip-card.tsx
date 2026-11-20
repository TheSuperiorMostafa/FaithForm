"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Film, Pencil, RotateCcw, Send, Undo2, Volume2, VolumeX, X } from "lucide-react";

import { JobProgress } from "@/components/sermon-media/job-progress";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CLIP_CARD } from "@/components/clips/clips-skeleton";
import { firstFrame, useStableUrl } from "@/components/clips/clip-media";
import {
  approveState,
  CAPTION_MAX,
  clipPlace,
  renderActive,
  type FacebookPage,
  type QueueItem,
} from "@/components/clips/format";
import { cn } from "@/lib/utils";
import { clipHref } from "@/lib/sermon-media/hrefs";

export type ClipCardActions = {
  approve: (item: QueueItem, caption: string, postNow: boolean) => Promise<boolean>;
  skip: (item: QueueItem) => void;
  restore: (item: QueueItem) => void;
  render: (item: QueueItem) => Promise<void>;
  saveCaption: (item: QueueItem, caption: string) => Promise<boolean>;
};

/**
 * One clip waiting for a decision: the exact final video, where it comes from,
 * why FaithForm picked it, the Facebook text, and Approve / Edit / Skip.
 * Approve unlocks when the video has played to the end or the person ticks
 * that they watched it.
 */
export function ClipCard({
  item,
  mode,
  timezone,
  canApprove,
  facebook,
  actions,
}: {
  item: QueueItem;
  mode: "review" | "skipped";
  timezone: string;
  canApprove: boolean;
  facebook: FacebookPage;
  actions: ClipCardActions;
}) {
  const ids = useId();
  const video = useRef<HTMLVideoElement>(null);
  const render = item.render;
  const src = useStableUrl(render?.id, render?.status === "ready" ? render.previewUrl : null);
  const [muted, setMuted] = useState(true);
  const [watched, setWatched] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [caption, setCaption] = useState(item.caption ?? "");
  const [savedCaption, setSavedCaption] = useState(item.caption ?? "");
  const [captionState, setCaptionState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState<"approve" | "now" | "render" | null>(null);

  // A new video (after an edit) has to be watched again.
  useEffect(() => {
    setWatched(false);
    setConfirmed(false);
  }, [render?.id, render?.specHash]);

  // Take the server's text only while the person isn't editing it.
  useEffect(() => {
    if (caption === savedCaption && item.caption !== savedCaption) {
      setCaption(item.caption ?? "");
      setSavedCaption(item.caption ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.caption]);

  const state = approveState({
    canApprove,
    facebook,
    render,
    needsReview: item.needsReview,
    watched,
    confirmed,
  });
  const ready = render?.status === "ready";
  const editHref = clipHref(item.id);

  const saveCaption = async () => {
    if (caption === savedCaption) return;
    setCaptionState("saving");
    const ok = await actions.saveCaption(item, caption);
    if (ok) setSavedCaption(caption);
    setCaptionState(ok ? "saved" : "failed");
  };

  const approve = async (postNow: boolean) => {
    if (busy) return;
    setBusy(postNow ? "now" : "approve");
    await actions.approve(item, caption, postNow);
    setBusy(null);
  };

  const makeVideo = async () => {
    if (busy) return;
    setBusy("render");
    await actions.render(item);
    setBusy(null);
  };

  return (
    <article className={CLIP_CARD} aria-labelledby={`${ids}-title`}>
      {/* The video box keeps its 9:16 shape in every state, so nothing jumps when the video arrives. */}
      <div className="relative aspect-[9/16] w-full overflow-hidden bg-black">
        {ready && src ? (
          <>
            <video
              ref={video}
              key={render.id}
              src={firstFrame(src) ?? undefined}
              controls
              playsInline
              muted={muted}
              preload="metadata"
              onEnded={() => setWatched(true)}
              onVolumeChange={(event) => setMuted(event.currentTarget.muted)}
              aria-label={`Final video of the clip from ${item.recordingTitle}`}
              className="size-full object-contain"
            />
            <button
              type="button"
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (video.current) video.current.muted = next;
              }}
              className="absolute left-3 top-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-black/65 px-4 text-[15px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {muted ? <VolumeX className="size-5" aria-hidden /> : <Volume2 className="size-5" aria-hidden />}
              {muted ? "Turn sound on" : "Turn sound off"}
            </button>
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-4 bg-muted p-6 text-center">
            <Film className="size-10 text-muted-foreground" aria-hidden strokeWidth={1.5} />
            {renderActive(render) ? (
              <div className="flex w-full flex-col gap-2">
                <p className="text-[15px] font-semibold">Making the video</p>
                {render?.job?.progressView ? (
                  <JobProgress progress={render.job.progressView} compact className="text-left" />
                ) : (
                  <p className="text-[15px] text-muted-foreground" role="status">
                    Waiting to start… This page updates by itself.
                  </p>
                )}
              </div>
            ) : render?.status === "failed" ? (
              <>
                <p className="text-[15px]" role="alert">
                  We couldn&apos;t make this video. {render.failureReason ?? "Please try again."}
                </p>
                <Button type="button" variant="outline" onClick={() => void makeVideo()} disabled={busy !== null}>
                  <RotateCcw aria-hidden />
                  {busy === "render" ? "Starting…" : "Try again"}
                </Button>
              </>
            ) : ready ? (
              <>
                <p className="text-[15px] text-muted-foreground">The video is ready but can&apos;t be played here.</p>
                {render.downloadUrl ? (
                  <a href={render.downloadUrl} download className={buttonVariants({ variant: "outline" })}>
                    Download to watch
                  </a>
                ) : null}
              </>
            ) : item.needsReview ? (
              <p className="text-[15px] text-muted-foreground">Check this clip in the editor, then make its video.</p>
            ) : (
              <>
                <p className="text-[15px] text-muted-foreground">There&apos;s no video for this clip yet.</p>
                <Button type="button" variant="outline" onClick={() => void makeVideo()} disabled={busy !== null}>
                  <Film aria-hidden />
                  {busy === "render" ? "Starting…" : "Make the video"}
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h3 id={`${ids}-title`} className="line-clamp-2 font-heading text-lg font-semibold leading-snug">
            {item.recordingTitle}
          </h3>
          <p className="text-sm text-muted-foreground">{clipPlace(item, timezone)}</p>
        </div>

        {item.needsReview ? (
          <div role="status" className="flex items-start gap-2 rounded-xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 dark:bg-orange-500/10 dark:text-orange-100">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>{item.reviewReason ?? "The sermon changed after this clip was made."} Open the editor to check its start and end.</span>
          </div>
        ) : null}

        {item.reason ? <p className="text-[15px] leading-relaxed">{item.reason}</p> : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${ids}-caption`} className="text-[15px] font-medium">
            Text for Facebook
          </Label>
          <Textarea
            id={`${ids}-caption`}
            value={caption}
            maxLength={CAPTION_MAX}
            rows={4}
            onChange={(event) => {
              setCaption(event.target.value);
              setCaptionState("idle");
            }}
            onBlur={() => void saveCaption()}
            aria-describedby={`${ids}-count`}
            className="min-h-[116px]"
            placeholder="A sentence about this moment, and an invitation to join you on Sunday."
          />
          <p id={`${ids}-count`} className="flex justify-between gap-3 text-sm text-muted-foreground" aria-live="polite">
            <span>
              {captionState === "saving"
                ? "Saving…"
                : captionState === "saved"
                  ? "Saved."
                  : captionState === "failed"
                    ? "Not saved yet. It will be used when you approve."
                    : ""}
            </span>
            <span className="tabular-nums">
              {caption.length} / {CAPTION_MAX}
            </span>
          </p>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          {canApprove && ready ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 text-[15px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span>
                I watched this video. It&apos;s OK to share publicly — no children or private moments shown without permission.
              </span>
            </label>
          ) : null}

          {canApprove ? (
            <>
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={!state.enabled || busy !== null}
                onClick={() => void approve(false)}
                aria-describedby={state.reason ? `${ids}-why` : undefined}
              >
                <CheckCircle2 aria-hidden />
                {busy === "approve" ? "Approving…" : "Approve"}
              </Button>
              <p id={`${ids}-why`} className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
                {state.reason ??
                  (watched && !confirmed
                    ? "You watched it to the end. Approving confirms it's OK to share publicly."
                    : "It will post at the next time on your posting schedule.")}
              </p>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={!state.enabled || busy !== null}
                onClick={() => void approve(true)}
              >
                <Send aria-hidden />
                {busy === "now" ? "Posting…" : "Post now instead"}
              </Button>
            </>
          ) : (
            <p className="rounded-xl bg-muted px-4 py-3 text-[15px]">Ask a church administrator to approve this clip.</p>
          )}

          <div className="flex flex-wrap gap-3">
            <Link href={editHref} className={cn(buttonVariants({ variant: "outline" }), "flex-1")}>
              <Pencil aria-hidden />
              Edit
            </Link>
            {mode === "review" ? (
              <Button type="button" variant="ghost" className="flex-1" onClick={() => actions.skip(item)} disabled={busy !== null}>
                <X aria-hidden />
                Skip
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="flex-1" onClick={() => actions.restore(item)} disabled={busy !== null}>
                <Undo2 aria-hidden />
                Back to review
              </Button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
