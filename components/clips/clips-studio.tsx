"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, Clapperboard, Send, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { apiRequest, clipApi } from "@/components/sermon-media/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipCard, type ClipCardActions } from "@/components/clips/clip-card";
import { PostedList, ScheduledList } from "@/components/clips/clip-rows";
import { CLIP_GRID, ClipsHeaderRow, ClipsViewLoading, TabCountSkeleton } from "@/components/clips/clips-skeleton";
import { MakeClipsDialog } from "@/components/clips/make-clips-dialog";
import { ScheduleDialog } from "@/components/clips/schedule-dialog";
import {
  CLIPS_EMPTY_REVIEW,
  CLIPS_VIEW_LABELS,
  CLIPS_VIEWS,
  facebookReady,
  needsPolling,
  POST_WORKING,
  scheduledMessage,
  type ClipsView,
  type FacebookPage,
  type QueueItem,
  type QueueResponse,
} from "@/components/clips/format";
import { integrationConnectHref } from "@/lib/integrations/connect-href";
import { CLIPS_HREF } from "@/lib/sermon-media/hrefs";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const NO_FACEBOOK: FacebookPage = { connected: false, pageName: null, pageId: null, needsReconnect: false };

type ViewData = { items: QueueItem[]; error: string | null; loaded: boolean };

function isView(value: string | null | undefined): value is ClipsView {
  return CLIPS_VIEWS.includes(value as ClipsView);
}

/**
 * The Clips view under Live > Recordings. FaithForm prepares clips after each
 * service (or when someone presses Make clips on a recording); an
 * administrator watches each final video and approves it with one tap; it
 * posts to Facebook on the church's schedule.
 */
export function ClipsStudio({ timezone, initialView }: { timezone: string; initialView?: string }) {
  const [view, setView] = useState<ClipsView>(isView(initialView) ? initialView : "review");
  const [data, setData] = useState<Partial<Record<ClipsView, ViewData>>>({});
  const [counts, setCounts] = useState<Record<ClipsView, number> | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [facebook, setFacebook] = useState<FacebookPage>(NO_FACEBOOK);
  const [makeOpen, setMakeOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const requestSeq = useRef<Record<string, number>>({});

  const load = useCallback(async (target: ClipsView) => {
    const seq = (requestSeq.current[target] ?? 0) + 1;
    requestSeq.current[target] = seq;
    const result = await apiRequest<QueueResponse>(`/api/sermon-media/queue?view=${target}`, {}, "We couldn't load your clips.");
    if (requestSeq.current[target] !== seq) return; // a newer request already answered
    if (result.ok) {
      setData((current) => ({ ...current, [target]: { items: result.data.items, error: null, loaded: true } }));
      setCounts(result.data.counts);
      setCanApprove(result.data.canApprove);
      setFacebook(result.data.facebook ?? NO_FACEBOOK);
    } else {
      // Keep what is already on screen; only a first load shows the error.
      setData((current) => ({
        ...current,
        [target]: { items: current[target]?.items ?? [], error: current[target]?.loaded ? null : result.error, loaded: current[target]?.loaded ?? false },
      }));
    }
  }, []);

  useEffect(() => {
    void load(view);
  }, [view, load]);

  const switchView = (next: string) => {
    if (!isView(next)) return;
    setView(next);
    try {
      const url = new URL(window.location.href);
      if (next === "review") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address bar is a convenience only.
    }
  };

  const current = data[view];
  const items = current?.items ?? [];
  const polling = needsPolling(items, view);

  // Check again every 5 seconds while a video is being made or a post is on its way.
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(async () => {
      if (view === "posted" && canApprove) {
        // Nudge posts Facebook is still working on (admins only), then reload.
        const working = (data.posted?.items ?? []).filter((item) => item.post?.id && POST_WORKING.includes(item.post.status)).slice(0, 5);
        await Promise.all(working.map((item) => apiRequest(`${clipApi(item.id)}/facebook?post=${item.post!.id}`)));
      }
      void load(view);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, view, load, canApprove, data.posted?.items]);

  /** Take a clip out of a list right away; the reload confirms it. */
  const removeLocally = (target: ClipsView, id: string, movedTo: ClipsView | null) => {
    setData((all) => {
      const entry = all[target];
      return entry ? { ...all, [target]: { ...entry, items: entry.items.filter((item) => item.id !== id) } } : all;
    });
    setCounts((tally) =>
      tally
        ? {
            ...tally,
            [target]: Math.max(0, tally[target] - 1),
            ...(movedTo ? { [movedTo]: tally[movedTo] + 1 } : {}),
          }
        : tally,
    );
  };

  const approveRequest = (item: QueueItem, caption: string, postNow: boolean) =>
    apiRequest<{ scheduledFor: string; pageName: string | null }>(
      `${clipApi(item.id)}/approve`,
      {
        method: "POST",
        body: { renderId: item.render?.id, specHash: item.render?.specHash, caption, reviewed: true, ...(postNow ? { postNow: true } : {}) },
      },
      "We couldn't approve that clip. Please try again.",
    );

  const pageName = facebook.pageName ?? "your Facebook Page";

  const confirmPostNow = () =>
    confirmAction({
      title: `Post this clip to ${pageName} now?`,
      description: `It will be public on ${pageName} as a Reel within a minute or two, with the text you wrote. To take it down later, delete it on Facebook.`,
      confirmLabel: "Post to Facebook now",
    });

  /** Post an already-approved clip now instead of at its time. */
  const postScheduledNow = async (item: QueueItem) => {
    if (!(await confirmPostNow())) return;
    const result = await approveRequest(item, item.caption ?? "", true);
    if (!result.ok) {
      toast.error(result.error);
      void load(view);
      return;
    }
    toast.success(`Posting to ${result.data.pageName ?? pageName} now. It moves to Posted within a minute or two.`);
    void load(view);
  };

  const cardActions: ClipCardActions = {
    approve: async (item, caption, postNow) => {
      if (postNow && !(await confirmPostNow())) return false;
      const result = await approveRequest(item, caption, postNow);
      if (!result.ok) {
        toast.error(result.error);
        void load(view);
        return false;
      }
      removeLocally(view, item.id, "scheduled");
      const approved = { ...item, caption, approvalStatus: "approved" as const, scheduledFor: result.data.scheduledFor };
      if (postNow) {
        toast.success(`Posting to ${result.data.pageName ?? pageName} now. It moves to Posted within a minute or two.`);
      } else {
        toast.success(scheduledMessage(result.data.scheduledFor, timezone, result.data.pageName), {
          duration: 10_000,
          action: { label: "Post now instead", onClick: () => void postScheduledNow(approved) },
        });
      }
      void load(view);
      return true;
    },
    skip: async (item) => {
      const result = await apiRequest(`${clipApi(item.id)}/approve`, { method: "PATCH", body: { decision: "skip" } }, "We couldn't skip that clip. Please try again.");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      removeLocally("review", item.id, "skipped");
      undoToast(
        `Skipped the clip from ${item.recordingTitle}. It's in Skipped if you change your mind.`,
        async () => {
          const undo = await apiRequest(`${clipApi(item.id)}/approve`, { method: "PATCH", body: { decision: "restore" } }, "We couldn't bring that clip back. Open Skipped to find it.");
          void load("review");
          if (!undo.ok) return undo.error;
        },
        { undoneMessage: "The clip is back in Ready to review." },
      );
      void load("review");
    },
    restore: async (item) => {
      const result = await apiRequest(`${clipApi(item.id)}/approve`, { method: "PATCH", body: { decision: "restore" } }, "We couldn't move that clip back. Please try again.");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      removeLocally("skipped", item.id, "review");
      toast.success("Moved the clip back to Ready to review.");
      void load("skipped");
    },
    render: async (item) => {
      const result = await apiRequest<{ status: string }>(`${clipApi(item.id)}/render`, { method: "POST" }, "We couldn't start making the video. Please try again.");
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.status === "ready" ? "The video is ready to watch." : "Making the video. This page updates by itself.");
      await load(view);
    },
    saveCaption: async (item, caption) => {
      const result = await apiRequest(
        clipApi(item.id),
        { method: "PATCH", body: { expectedEditVersion: item.editVersion, facebookCaption: caption } },
        "We couldn't save the Facebook text.",
      );
      if (!result.ok && result.status === 409) void load(view);
      return result.ok;
    },
  };

  const unschedule = async (item: QueueItem) => {
    const result = await apiRequest(`${clipApi(item.id)}/approve`, { method: "PATCH", body: { decision: "unschedule" } }, "We couldn't take that clip off the schedule.");
    if (!result.ok) {
      toast.error(result.error);
      void load("scheduled");
      return;
    }
    removeLocally("scheduled", item.id, "review");
    undoToast(
      `Took the clip from ${item.recordingTitle} off the schedule. It's back in Ready to review.`,
      async () => {
        const again = await approveRequest(item, item.caption ?? "", false);
        void load("scheduled");
        if (!again.ok) return again.error;
      },
      { undoneMessage: "The clip is back on the schedule." },
    );
    void load("scheduled");
  };

  const retryPost = async (item: QueueItem) => {
    if (!item.render || !facebook.pageId) {
      toast.error("Open the clip to make its video again, then post it.");
      return;
    }
    const result = await apiRequest<{ post: unknown }>(
      `${clipApi(item.id)}/facebook`,
      {
        method: "POST",
        body: { renderId: item.render.id, specHash: item.render.specHash, pageId: facebook.pageId, caption: item.caption ?? "", reviewed: true },
      },
      "We couldn't post to Facebook. Your clip is saved; try again in a few minutes.",
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Sent to ${pageName} again. We'll show here when it's live.`);
    void load("posted");
  };

  const onMade = (made: number, title: string, transcribing: boolean) => {
    if (transcribing) {
      toast.success(
        `Making clips from ${title}. FaithForm writes out the service first, so they'll be in Ready to review in a few minutes.`,
      );
    } else if (made > 0) {
      toast.success(
        `Making ${made} clip${made === 1 ? "" : "s"} from ${title}. They're in Ready to review now, and each video is ready to watch in a few minutes.`,
      );
    } else {
      toast.success(`We didn't find new moments in ${title}. Its clips are already here.`);
    }
    switchView("review");
    void load("review");
  };

  const fbProblem = counts !== null && !facebookReady(facebook);
  const connectHref = integrationConnectHref("facebook", CLIPS_HREF);

  const emptyFor: Record<ClipsView, { title: string; description: string }> = {
    review: { title: "No clips waiting", description: CLIPS_EMPTY_REVIEW },
    scheduled: {
      title: "Nothing scheduled",
      description: "When you approve a clip, it waits here until its time on your posting schedule.",
    },
    posted: { title: "Nothing posted yet", description: "Clips show here once they're on your Facebook Page, with a link to each one." },
    skipped: { title: "No skipped clips", description: "Clips you skip are kept here, in case you change your mind." },
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <ClipsHeaderRow
        secondary={
          <Button type="button" variant="outline" onClick={() => setScheduleOpen(true)}>
            <CalendarDays aria-hidden />
            Posting schedule
          </Button>
        }
        action={
          <Button type="button" onClick={() => setMakeOpen(true)}>
            <Sparkles aria-hidden />
            Make clips
          </Button>
        }
      />

      <Tabs defaultValue="review" value={view} onValueChange={switchView}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Clips by step" className="w-full min-w-max justify-start">
            {CLIPS_VIEWS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {CLIPS_VIEW_LABELS[key]}
                {counts === null ? (
                  <TabCountSkeleton />
                ) : (
                  <span
                    className={cn(
                      "ml-2 inline-flex h-6 min-w-7 items-center justify-center rounded-full px-2 text-sm tabular-nums",
                      key === "review" && counts.review > 0 ? "bg-accent text-accent-foreground" : "bg-muted text-foreground/75",
                    )}
                  >
                    <span className="sr-only">(</span>
                    {counts[key]}
                    <span className="sr-only">)</span>
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {CLIPS_VIEWS.map((key) => (
          <TabsContent key={key} value={key} className="mt-6 flex flex-col gap-6">
            {fbProblem && (key === "review" || key === "scheduled" || key === "posted") ? (
              <div
                role="status"
                className="flex flex-col gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 text-[15px] text-orange-900 sm:flex-row sm:items-center sm:justify-between dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-100"
              >
                <span className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <span>
                    {facebook.needsReconnect
                      ? "Your church's Facebook Page needs to be reconnected. Clips can't be approved or posted until it is."
                      : "Connect your church's Facebook Page so approved clips can post."}
                    {!canApprove ? " Ask a church administrator to do this." : ""}
                  </span>
                </span>
                {canApprove ? (
                  <a href={connectHref} className={cn(buttonVariants({ variant: "outline" }), "w-fit shrink-0")}>
                    {facebook.needsReconnect ? "Reconnect Facebook" : "Connect Facebook"}
                  </a>
                ) : null}
              </div>
            ) : null}

            {!current?.loaded ? (
              current?.error ? (
                <ErrorState compact description={current.error} onRetry={() => void load(key)} />
              ) : (
                <ClipsViewLoading view={key} />
              )
            ) : items.length === 0 ? (
              <EmptyState
                icon={key === "scheduled" ? CalendarClock : key === "posted" ? Send : key === "skipped" ? Undo2 : Clapperboard}
                title={emptyFor[key].title}
                description={emptyFor[key].description}
                action={
                  key === "review" ? (
                    <Button type="button" variant="outline" onClick={() => setMakeOpen(true)}>
                      <Sparkles aria-hidden />
                      Make clips from a service
                    </Button>
                  ) : undefined
                }
              />
            ) : key === "review" || key === "skipped" ? (
              <div className={CLIP_GRID}>
                {items.map((item) => (
                  <ClipCard
                    key={item.id}
                    item={item}
                    mode={key}
                    timezone={timezone}
                    canApprove={canApprove}
                    facebook={facebook}
                    actions={cardActions}
                  />
                ))}
              </div>
            ) : key === "scheduled" ? (
              <ScheduledList items={items} timezone={timezone} canApprove={canApprove} onUnschedule={unschedule} onPostNow={postScheduledNow} />
            ) : (
              <PostedList items={items} timezone={timezone} canApprove={canApprove} onRetry={retryPost} />
            )}
          </TabsContent>
        ))}
      </Tabs>

      <MakeClipsDialog open={makeOpen} onOpenChange={setMakeOpen} timezone={timezone} onMade={onMade} />
      <ScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} fallbackTimezone={timezone} />
    </div>
  );
}
