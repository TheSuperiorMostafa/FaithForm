"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Film, Play, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  apiRequest,
  clipApi,
  type CaptionCue,
  type ClipDetail,
  type Framing,
  type ReelPost,
} from "@/components/sermon-media/api";
import { ClipEditorBodySkeleton } from "@/components/sermon-media/clip-editor-skeleton";
import { SourcePlayer, type SourcePlayerHandle } from "@/components/sermon-media/source-player";
import { TimeField } from "@/components/sermon-media/time-field";
import { formatLength, formatTime } from "@/components/sermon-media/time";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const REEL_MIN_SEC = 3;
const REEL_MAX_SEC = 90;
const CAPTION_MAX = 2200;
/** A 9:16 crop of a 16:9 picture is this share of its width. */
const CROP_WIDTH = (9 / 16) / (16 / 9);
const POST_WORKING = ["starting", "uploading", "finishing", "processing", "needs_check"];

type Draft = {
  start: number;
  end: number;
  framing: Framing;
  captionsEnabled: boolean;
  /** null until someone edits a caption line. */
  captions: CaptionCue[] | null;
  facebookCaption: string;
};

const draftFrom = (detail: ClipDetail): Draft => ({
  start: Number(detail.clip.start_sec),
  end: Number(detail.clip.end_sec),
  framing: detail.clip.framing ?? { mode: "speaker" },
  captionsEnabled: detail.clip.captions_enabled,
  captions: null,
  facebookCaption: detail.clip.facebook_caption ?? "",
});

const sameFraming = (a: Framing, b: Framing) => a.mode === b.mode && (a.mode !== "manual" || (a.x ?? 0.5) === (b.x ?? 0.5));

function postStatusText(post: ReelPost): { tone: "working" | "done" | "attention"; label: string; detail: string } {
  switch (post.status) {
    case "posted":
      return { tone: "done", label: "Posted", detail: "This clip is on your Facebook Page." };
    case "processing":
      return { tone: "working", label: "Processing", detail: "Facebook is processing the video… This page updates by itself." };
    case "needs_check":
      return { tone: "working", label: "Checking", detail: "We're confirming with Facebook… This page updates by itself." };
    case "failed":
      return {
        tone: "attention",
        label: "Not posted",
        detail: post.last_error ?? "Facebook didn't accept the video. Your clip is saved; try again.",
      };
    default:
      return { tone: "working", label: "Posting", detail: "Posting… Please keep this page open." };
  }
}

/**
 * Edit one sermon clip: trim it inside the sermon, choose the framing, check
 * the captions and the Facebook text, make the final vertical video, watch it,
 * and (church admins) post it to the church's Facebook Page.
 */
export function ClipEditor({
  clipId,
  recordingId,
  recordingTitle,
  source,
  posterUrl,
}: {
  clipId: string;
  recordingId: string;
  recordingTitle: string;
  source: { kind: "hls" | "progressive"; url: string } | null;
  posterUrl: string | null;
}) {
  const player = useRef<SourcePlayerHandle>(null);
  const [detail, setDetail] = useState<ClipDetail | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error" | "off" | "missing">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveProblem, setSaveProblem] = useState<{ message: string; conflict: boolean } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postProblem, setPostProblem] = useState<string | null>(null);
  const postLock = useRef(false);
  const dirtyRef = useRef(false);

  const backHref = `/dashboard/live-streaming/recordings/${recordingId}`;

  const load = useCallback(
    async (reset = false) => {
      const result = await apiRequest<ClipDetail>(clipApi(clipId), {}, "We couldn't load this clip.");
      if (result.ok) {
        setDetail(result.data);
        setLoadState("ready");
        setLoadError(null);
        if (reset || !dirtyRef.current) setDraft(draftFrom(result.data));
        return;
      }
      if (result.status === 403) setLoadState("off");
      else if (result.status === 404) setLoadState("missing");
      else {
        setLoadError(result.error);
        setLoadState((current) => (current === "ready" ? current : "error"));
      }
    },
    [clipId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const clip = detail?.clip;
  const sermon = detail?.sermon ?? null;
  const render = detail?.render ?? null;

  const dirtyRender = Boolean(
    clip &&
      draft &&
      (draft.start !== Number(clip.start_sec) ||
        draft.end !== Number(clip.end_sec) ||
        !sameFraming(draft.framing, clip.framing ?? { mode: "speaker" }) ||
        draft.captionsEnabled !== clip.captions_enabled ||
        draft.captions !== null),
  );
  const dirtyCaption = Boolean(clip && draft && draft.facebookCaption !== (clip.facebook_caption ?? ""));
  const dirty = dirtyRender || dirtyCaption;
  dirtyRef.current = dirty;

  // Any edit that changes the video means the person must watch a new one.
  useEffect(() => {
    if (dirtyRender) setReviewed(false);
  }, [dirtyRender]);
  useEffect(() => {
    setReviewed(false);
  }, [render?.id, render?.specHash]);

  // Poll while the final video is being made.
  const renderActive = render?.status === "queued" || render?.status === "rendering";
  useEffect(() => {
    if (!renderActive) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [renderActive, load]);

  const currentPost = useMemo(
    () => (render && detail ? (detail.posts.find((post) => post.render_id === render.id) ?? null) : null),
    [render, detail],
  );

  // Poll a post Facebook is still working on.
  const postWorking = Boolean(currentPost && POST_WORKING.includes(currentPost.status));
  const postId = currentPost?.id;
  useEffect(() => {
    if (!postWorking || !postId) return;
    const timer = window.setInterval(async () => {
      const result = await apiRequest<{ post: ReelPost }>(`${clipApi(clipId)}/facebook?post=${postId}`);
      if (!result.ok) return;
      setDetail((current) =>
        current
          ? { ...current, posts: current.posts.map((post) => (post.id === postId ? { ...post, ...result.data.post } : post)) }
          : current,
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [postWorking, postId, clipId]);

  if (loadState === "loading") return <ClipEditorBodySkeleton />;
  if (loadState === "off") {
    return (
      <ErrorState
        compact
        title="Sermon clips aren't turned on"
        description="Sermon transcripts and clips aren't turned on for your church yet, or your role can't use them."
        homeHref="/dashboard"
      />
    );
  }
  if (loadState === "missing") {
    return (
      <div className="flex flex-col items-start gap-4">
        <ErrorState compact title="We couldn't find this clip" description="It may have been removed. Go back to the recording to see its clips." />
        <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
          Back to the recording
        </Link>
      </div>
    );
  }
  if (loadState === "error" || !detail || !clip || !draft) {
    return <ErrorState compact description={loadError ?? undefined} onRetry={() => void load(true)} />;
  }

  const length = draft.end - draft.start;
  const trimProblem = !sermon
    ? "Confirm the sermon times on the recording page first."
    : draft.end <= draft.start
      ? "The clip has to end after it starts."
      : length < REEL_MIN_SEC || length > REEL_MAX_SEC
        ? `A Facebook Reel must be between ${REEL_MIN_SEC} and ${REEL_MAX_SEC} seconds. This clip is ${formatLength(length)}.`
        : draft.start < sermon.startSec - 0.001 || draft.end > sermon.endSec + 0.001
          ? `A clip has to stay inside the sermon (${formatTime(sermon.startSec)} – ${formatTime(sermon.endSec)}).`
          : null;

  const update = (patch: Partial<Draft>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const now = () => player.current?.currentTime() ?? draft.start;

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (dirtyRender && trimProblem) {
      setSaveProblem({ message: trimProblem, conflict: false });
      return false;
    }
    setSaving(true);
    setSaveProblem(null);
    const body: Record<string, unknown> = { expectedEditVersion: clip.edit_version };
    if (draft.start !== Number(clip.start_sec)) body.startSec = draft.start;
    if (draft.end !== Number(clip.end_sec)) body.endSec = draft.end;
    if (!sameFraming(draft.framing, clip.framing ?? { mode: "speaker" })) {
      body.framing = draft.framing.mode === "manual" ? { mode: "manual", x: draft.framing.x ?? 0.5 } : { mode: draft.framing.mode };
    }
    if (draft.captionsEnabled !== clip.captions_enabled) body.captionsEnabled = draft.captionsEnabled;
    if (draft.captions !== null) {
      body.captions = draft.captions.map(({ start, end, text }) => ({ start, end, text: text.trim() }));
    }
    if (dirtyCaption) body.facebookCaption = draft.facebookCaption;
    const result = await apiRequest<unknown>(clipApi(clipId), { method: "PATCH", body }, "We couldn't save the clip. Please try again.");
    setSaving(false);
    if (!result.ok) {
      setSaveProblem({ message: result.error, conflict: result.status === 409 });
      return false;
    }
    toast.success(dirtyRender ? "Saved your clip. Make the final video again to see the changes." : "Saved the Facebook text.");
    await load(true);
    return true;
  };

  const makeFinalVideo = async () => {
    if (rendering) return;
    if (dirty && !(await save())) return;
    setRendering(true);
    const result = await apiRequest<{ renderId: string; status: string }>(
      `${clipApi(clipId)}/render`,
      { method: "POST" },
      "We couldn't start making the video. Please try again.",
    );
    setRendering(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.data.status === "ready" ? "The final video is ready to watch." : "Making the final video. This page updates by itself.");
    await load();
  };

  const post = async () => {
    if (!render || !detail.facebook.pageId || postLock.current) return;
    const pageName = detail.facebook.pageName ?? "your church's Facebook Page";
    const ok = await confirmAction({
      title: `Post this clip to ${pageName}?`,
      description: `It will be public on ${pageName} as a Reel, with the text you wrote. To take it down later, delete it on Facebook.`,
      confirmLabel: "Post to Facebook",
    });
    if (!ok || postLock.current) return;
    postLock.current = true;
    setPosting(true);
    setPostProblem(null);
    const result = await apiRequest<{ post: ReelPost }>(
      `${clipApi(clipId)}/facebook`,
      {
        method: "POST",
        body: {
          renderId: render.id,
          specHash: render.specHash,
          pageId: detail.facebook.pageId,
          caption: draft.facebookCaption,
          reviewed: true,
        },
      },
      "We couldn't post to Facebook. Your clip is saved; try again in a few minutes.",
    );
    setPosting(false);
    postLock.current = false;
    if (!result.ok) {
      setPostProblem(result.error);
      return;
    }
    const fresh = { ...result.data.post, render_id: render.id };
    setDetail((current) =>
      current ? { ...current, posts: [fresh, ...current.posts.filter((item) => item.id !== fresh.id)] } : current,
    );
    if (fresh.status === "posted") toast.success(`Posted to ${pageName}.`);
    else if (fresh.status !== "failed") toast.success("Sent to Facebook. We'll show here when it's live.");
  };

  const playClip = () => player.current?.playFrom(draft.start, draft.end);
  const captions = draft.captions ?? detail.captions;
  const approximate = captions.some((cue) => cue.approximate);
  const validationProblems = render?.validation?.ok === false ? (render.validation.problems ?? []) : [];
  const renderReady = render?.status === "ready" && render.matchesCurrentEdit && !dirtyRender;
  const needsReview = clip.needs_review || detail.stale;
  const facebookReady = detail.facebook.connected && !detail.facebook.needsReconnect && Boolean(detail.facebook.pageId);
  const alreadyPosted = Boolean(currentPost && currentPost.status !== "failed");
  const postStatus = currentPost ? postStatusText(currentPost) : null;

  // Crop guide position over the 16:9 player.
  const cropX = draft.framing.mode === "manual" ? (draft.framing.x ?? 0.5) : 0.5;
  const cropLeft = Math.min(Math.max(cropX - CROP_WIDTH / 2, 0), 1 - CROP_WIDTH);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      {needsReview ? (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-[15px] text-orange-900 lg:col-span-2 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-100">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            {clip.review_reason ?? "The sermon times or transcript changed after this clip was made."} Check the start and end, then save to
            mark it reviewed.
          </span>
        </div>
      ) : null}

      {/* Left: preview and edits */}
      <div className="flex min-w-0 flex-col gap-6">
        {source ? (
          <SourcePlayer ref={player} src={source.url} kind={source.kind} poster={posterUrl} title={`${recordingTitle} — clip preview`}>
            {draft.framing.mode !== "wide_fit" ? (
              <div aria-hidden className="absolute inset-y-0 w-full">
                <div className="absolute inset-y-0 left-0 bg-black/55" style={{ width: `${cropLeft * 100}%` }} />
                <div
                  className="absolute inset-y-0 border-2 border-white/90"
                  style={{ left: `${cropLeft * 100}%`, width: `${CROP_WIDTH * 100}%` }}
                />
                <div className="absolute inset-y-0 right-0 bg-black/55" style={{ width: `${(1 - cropLeft - CROP_WIDTH) * 100}%` }} />
              </div>
            ) : null}
          </SourcePlayer>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-muted px-6 text-center text-[15px] text-muted-foreground">
            The recording can&apos;t be played right now.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={playClip} className="gap-2" disabled={!source}>
            <Play aria-hidden />
            Play the clip
          </Button>
          <span className="text-[15px] text-muted-foreground">
            {formatTime(draft.start)} – {formatTime(draft.end)} · {formatLength(length)}
          </span>
        </div>

        <section aria-labelledby="clip-trim-heading" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <div className="space-y-1">
            <h2 id="clip-trim-heading" className="font-heading text-lg font-semibold">
              Start and end
            </h2>
            <p className="text-[15px] text-muted-foreground">
              Reels are {REEL_MIN_SEC}–{REEL_MAX_SEC} seconds and stay inside the sermon
              {sermon ? ` (${formatTime(sermon.startSec)} – ${formatTime(sermon.endSec)})` : ""}.
            </p>
          </div>
          <TimeField
            label="Clip starts"
            value={draft.start}
            min={sermon?.startSec}
            max={sermon?.endSec}
            onChange={(start) => update({ start })}
            onUseCurrent={() => update({ start: Math.round(now() * 10) / 10 })}
            onPreview={() => player.current?.playFrom(draft.start, Math.min(draft.end, draft.start + 5))}
            previewLabel="Play the start"
          />
          <TimeField
            label="Clip ends"
            value={draft.end}
            min={sermon?.startSec}
            max={sermon?.endSec}
            onChange={(end) => update({ end })}
            onUseCurrent={() => update({ end: Math.round(now() * 10) / 10 })}
            onPreview={() => player.current?.playFrom(Math.max(draft.start, draft.end - 5), draft.end)}
            previewLabel="Play the end"
          />
          <p className={cn("text-[15px]", trimProblem ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
            {trimProblem ?? `The clip is ${formatLength(length)} long.`}
          </p>
        </section>

        <section aria-labelledby="clip-framing-heading" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <div className="space-y-1">
            <h2 id="clip-framing-heading" className="font-heading text-lg font-semibold">
              Framing
            </h2>
            <p className="text-[15px] text-muted-foreground">Reels are tall. Choose what fits in the tall picture.</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Framing</legend>
            {(
              [
                { mode: "speaker", label: "Follow the speaker (automatic)", hint: "FaithForm keeps the person speaking in the picture." },
                { mode: "wide_fit", label: "Show the whole picture", hint: "The full picture with a soft blurred background above and below." },
                { mode: "manual", label: "Choose the framing", hint: "Pick which part of the picture to show." },
              ] as const
            ).map((option) => (
              <label
                key={option.mode}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  draft.framing.mode === option.mode && "border-accent bg-accent/[0.06]",
                )}
              >
                <input
                  type="radio"
                  name="framing"
                  value={option.mode}
                  checked={draft.framing.mode === option.mode}
                  onChange={() =>
                    update({ framing: option.mode === "manual" ? { mode: "manual", x: draft.framing.x ?? 0.5 } : { mode: option.mode } })
                  }
                  className="mt-1 size-4 accent-primary"
                />
                <span className="flex flex-col">
                  <span className="text-[15px] font-medium">{option.label}</span>
                  <span className="text-sm text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {draft.framing.mode === "manual" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="framing-x" className="text-[15px]">
                Horizontal position
              </Label>
              <input
                id="framing-x"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={draft.framing.x ?? 0.5}
                onChange={(event) => update({ framing: { mode: "manual", x: Number(event.target.value) } })}
                aria-valuetext={`${Math.round((draft.framing.x ?? 0.5) * 100)}% from the left`}
                className="h-11 w-full cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-sm text-muted-foreground" aria-hidden>
                <span>Left</span>
                <span>Center</span>
                <span>Right</span>
              </div>
            </div>
          ) : draft.framing.mode === "speaker" ? (
            <p className="text-sm text-muted-foreground">The box on the video shows the tall shape. The final video follows the speaker.</p>
          ) : null}
        </section>

        <section
          aria-labelledby="clip-captions-heading"
          className="flex max-h-[min(70dvh,36rem)] flex-col rounded-2xl border border-border bg-card shadow-card dark:shadow-none"
        >
          <div className="flex shrink-0 flex-col gap-3 p-6 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <h2 id="clip-captions-heading" className="font-heading text-lg font-semibold">
                  Captions
                </h2>
                <p className="text-[15px] text-muted-foreground">Words on screen help people watching without sound.</p>
              </div>
              <div className="flex items-center gap-3">
                <Label htmlFor="captions-on" className="text-[15px]">
                  Show captions
                </Label>
                <Switch id="captions-on" checked={draft.captionsEnabled} onCheckedChange={(checked) => update({ captionsEnabled: checked })} />
              </div>
            </div>
            {draft.captionsEnabled && approximate ? (
              <p className="text-sm text-muted-foreground">Some caption times are estimated. Play the clip to check they line up.</p>
            ) : null}
            {draft.captionsEnabled && (draft.start !== Number(clip.start_sec) || draft.end !== Number(clip.end_sec)) ? (
              <p className="text-sm text-muted-foreground">The caption lines update after you save the new start and end.</p>
            ) : null}
          </div>
          {draft.captionsEnabled ? (
            captions.length === 0 ? (
              <p className="px-6 pb-6 text-[15px] text-muted-foreground">There are no words in this part of the transcript.</p>
            ) : (
              <ol className="flex min-h-0 flex-auto flex-col gap-1 overflow-y-auto overscroll-contain border-t border-border p-3" aria-label="Caption lines">
                {captions.map((cue, index) => (
                  <li key={`${index}-${cue.start}`} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => player.current?.playFrom(Number(clip.start_sec) + cue.start, Number(clip.start_sec) + cue.end)}
                      aria-label={`Play caption line ${index + 1}`}
                      className="inline-flex min-h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-lg px-2 font-mono text-sm tabular-nums text-primary hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
                    >
                      {formatTime(Number(clip.start_sec) + cue.start)}
                    </button>
                    <Label htmlFor={`cue-${index}`} className="sr-only">
                      Caption line {index + 1}
                    </Label>
                    <Input
                      id={`cue-${index}`}
                      value={cue.text}
                      maxLength={200}
                      onChange={(event) => {
                        const next = captions.map((item, i) => (i === index ? { ...item, text: event.target.value } : item));
                        update({ captions: next });
                      }}
                    />
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="px-6 pb-6 text-[15px] text-muted-foreground">Captions are off for this clip.</p>
          )}
        </section>
      </div>

      {/* Right: text, save, final video, review and post */}
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="clip-text-heading" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <Label id="clip-text-heading" htmlFor="facebook-caption" className="font-heading text-lg font-semibold">
            Text for Facebook
          </Label>
          <Textarea
            id="facebook-caption"
            value={draft.facebookCaption}
            maxLength={CAPTION_MAX}
            onChange={(event) => update({ facebookCaption: event.target.value })}
            rows={5}
            aria-describedby="facebook-caption-count"
            placeholder="A sentence about this moment, and an invitation to join you on Sunday."
          />
          <p id="facebook-caption-count" className="text-right text-sm text-muted-foreground">
            {draft.facebookCaption.length} / {CAPTION_MAX}
          </p>
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          {saveProblem ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
              <span className="min-w-0 flex-1">{saveProblem.message}</span>
              {saveProblem.conflict ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSaveProblem(null);
                    void load(true);
                  }}
                >
                  Reload the clip
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {dirty ? (
              <Button type="button" variant="ghost" onClick={() => setDraft(draftFrom(detail))} disabled={saving}>
                Undo my changes
              </Button>
            ) : null}
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {dirty ? "You have unsaved changes." : "All changes saved."}
            </span>
          </div>
        </div>

        <section aria-labelledby="clip-final-heading" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <div className="space-y-1">
            <h2 id="clip-final-heading" className="font-heading text-lg font-semibold">
              Final video
            </h2>
            <p className="text-[15px] text-muted-foreground">This is exactly what will be posted. Watch it all the way through.</p>
          </div>

          {renderReady && render ? (
            <>
              {render.previewUrl ? (
                <video
                  key={render.id}
                  src={render.previewUrl}
                  controls
                  playsInline
                  preload="metadata"
                  aria-label="The final video that will be posted"
                  className="mx-auto aspect-[9/16] max-h-[min(70dvh,36rem)] w-auto max-w-full rounded-2xl bg-black"
                />
              ) : (
                <p className="text-[15px] text-muted-foreground">The video is ready but can&apos;t be played here. Download it to watch.</p>
              )}
              {validationProblems.length > 0 ? (
                <div role="alert" className="rounded-xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 dark:bg-orange-500/10 dark:text-orange-100">
                  <p className="font-medium">Facebook may not accept this video:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {validationProblems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {render.downloadUrl ? (
                  <a href={render.downloadUrl} className={cn(buttonVariants({ variant: "outline" }), "gap-2")} download>
                    <Download aria-hidden />
                    Download video
                  </a>
                ) : null}
              </div>
            </>
          ) : render && (render.status === "queued" || render.status === "rendering") && !dirtyRender ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <StatusBadge tone="working" className="w-fit">
                Making the video
              </StatusBadge>
              <p className="text-[15px]">
                {render.status === "queued"
                  ? "Waiting to start…"
                  : `Making the final video…${render.job?.progress != null ? ` ${Math.round(render.job.progress * 100)}%` : ""}`}{" "}
                This page updates by itself.
              </p>
              {render.job?.progress != null ? (
                <div
                  role="progressbar"
                  aria-label="Final video progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(render.job.progress * 100)}
                  className="h-2 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(render.job.progress * 100)}%` }} />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3">
              {render?.status === "failed" && !dirtyRender ? (
                <p role="alert" className="text-[15px]">
                  We couldn&apos;t make the video. {render.failureReason ?? "Please try again."}
                </p>
              ) : render && !render.matchesCurrentEdit ? (
                <p className="text-[15px]">The captions or sermon text changed after this video was made. Make the final video again before posting.</p>
              ) : dirtyRender || detail.posts.length > 0 ? (
                <p className="text-[15px]">You changed the clip. Make the final video again before posting.</p>
              ) : (
                <p className="text-[15px] text-muted-foreground">Make the final video to see exactly what will be posted.</p>
              )}
              <Button type="button" size="lg" onClick={() => void makeFinalVideo()} disabled={rendering || saving || Boolean(trimProblem)} className="gap-2">
                {render?.status === "failed" ? <RotateCcw aria-hidden /> : <Film aria-hidden />}
                {rendering ? "Starting…" : render?.status === "failed" ? "Try again" : "Make the final video"}
              </Button>
              {trimProblem ? <p className="text-sm text-muted-foreground">Fix the start and end first.</p> : null}
            </div>
          )}
        </section>

        <section aria-labelledby="clip-post-heading" className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <h2 id="clip-post-heading" className="font-heading text-lg font-semibold">
            Post to Facebook
          </h2>

          {postStatus && currentPost ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <StatusBadge tone={postStatus.tone} className="w-fit">
                {postStatus.tone === "done" ? <CheckCircle2 className="size-4" aria-hidden /> : null}
                {postStatus.label}
              </StatusBadge>
              <p className="text-[15px]">{postStatus.detail}</p>
              {currentPost.status === "posted" && currentPost.permalink ? (
                <a
                  href={currentPost.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "outline" }), "w-fit gap-2")}
                >
                  View on Facebook <ExternalLink className="size-4" aria-hidden />
                </a>
              ) : null}
            </div>
          ) : null}

          {!renderReady ? (
            <p className="text-[15px] text-muted-foreground">Make the final video and watch it, then you can post it.</p>
          ) : !detail.canPublish ? (
            <p className="text-[15px] text-muted-foreground">Ask a church administrator to post this.</p>
          ) : !facebookReady ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[15px]">
                {detail.facebook.needsReconnect
                  ? "Your church's Facebook Page needs to be reconnected before you can post."
                  : "Connect your church's Facebook Page to post clips."}
              </p>
              <Link href="/dashboard/settings" className={buttonVariants({ variant: "outline" })}>
                {detail.facebook.needsReconnect ? "Reconnect Facebook in Settings" : "Connect Facebook in Settings"}
              </Link>
            </div>
          ) : alreadyPosted ? null : (
            <div className="flex flex-col gap-4">
              {needsReview ? (
                <p className="text-[15px]">Check the clip&apos;s start and end and save before posting.</p>
              ) : null}
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                  className="mt-1 size-4 shrink-0"
                />
                <span className="text-[15px]">
                  I watched the final video. It&apos;s OK to share publicly — no children or private moments shown without permission.
                </span>
              </label>
              {postProblem ? (
                <p role="alert" className="rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
                  {postProblem}
                </p>
              ) : null}
              <Button
                type="button"
                size="lg"
                onClick={() => void post()}
                disabled={!reviewed || posting || needsReview || validationProblems.length > 0}
                className="w-fit gap-2"
              >
                <Send aria-hidden />
                {posting
                  ? "Posting…"
                  : currentPost?.status === "failed"
                    ? "Try again"
                    : `Post to Facebook as ${detail.facebook.pageName ?? "your Page"}`}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
