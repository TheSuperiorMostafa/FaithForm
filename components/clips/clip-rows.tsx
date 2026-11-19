"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarX2, ExternalLink, Film, RotateCcw, Send } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CLIP_ROW_LIST } from "@/components/clips/clips-skeleton";
import { firstFrame, useStableUrl } from "@/components/clips/clip-media";
import { clipPlace, formatPostTime, postView, type QueueItem } from "@/components/clips/format";
import { cn } from "@/lib/utils";

/** A small still of the final video that opens the clip. */
function Thumb({ item }: { item: QueueItem }) {
  const src = useStableUrl(item.render?.id, item.render?.status === "ready" ? item.render.previewUrl : null);
  return (
    <Link
      href={`/dashboard/clips/${item.id}`}
      aria-label={`Open the clip from ${item.recordingTitle}`}
      className="relative block aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {src ? (
        <video src={firstFrame(src) ?? undefined} muted playsInline preload="metadata" aria-hidden tabIndex={-1} className="pointer-events-none size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center bg-muted">
          <Film className="size-6 text-muted-foreground" aria-hidden strokeWidth={1.5} />
        </span>
      )}
    </Link>
  );
}

function Row({
  item,
  timezone,
  children,
  top,
  bottom,
}: {
  item: QueueItem;
  timezone: string;
  top: React.ReactNode;
  bottom?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:p-4">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Thumb item={item} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {top}
          <p className="truncate text-[15px] font-medium">{item.recordingTitle}</p>
          <p className="text-sm text-muted-foreground">{clipPlace(item, timezone)}</p>
          {item.caption ? <p className="line-clamp-2 text-sm text-muted-foreground">{item.caption}</p> : null}
          {bottom}
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-wrap gap-3">{children}</div> : null}
    </li>
  );
}

export function ScheduledList({
  items,
  timezone,
  canApprove,
  onUnschedule,
  onPostNow,
}: {
  items: QueueItem[];
  timezone: string;
  canApprove: boolean;
  onUnschedule: (item: QueueItem) => Promise<void>;
  onPostNow: (item: QueueItem) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    await action();
    setBusy(null);
  };
  const sorted = [...items].sort((a, b) => (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? ""));
  return (
    <ul className={CLIP_ROW_LIST} aria-label="Scheduled clips">
      {sorted.map((item) => {
        const due = item.scheduledFor ? new Date(item.scheduledFor).getTime() - Date.now() < 2 * 60_000 : false;
        return (
          <Row
            key={item.id}
            item={item}
            timezone={timezone}
            top={
              <p className="font-heading text-base font-semibold">
                {due ? "Posting in a moment…" : item.scheduledFor ? formatPostTime(item.scheduledFor, timezone) : "Waiting for a time"}
              </p>
            }
          >
            {canApprove ? (
              <>
                <Button type="button" variant="outline" disabled={busy !== null || due} onClick={() => void run(item.id, () => onPostNow(item))}>
                  <Send aria-hidden />
                  Post now
                </Button>
                <Button type="button" variant="ghost" disabled={busy !== null || due} onClick={() => void run(item.id, () => onUnschedule(item))}>
                  <CalendarX2 aria-hidden />
                  Unschedule
                </Button>
              </>
            ) : null}
          </Row>
        );
      })}
    </ul>
  );
}

export function PostedList({
  items,
  timezone,
  canApprove,
  onRetry,
}: {
  items: QueueItem[];
  timezone: string;
  canApprove: boolean;
  onRetry: (item: QueueItem) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <ul className={CLIP_ROW_LIST} aria-label="Posted clips">
      {items.map((item) => {
        const view = postView(item.post);
        const when = item.post?.posted_at ?? item.post?.created_at ?? null;
        return (
          <Row
            key={item.id}
            item={item}
            timezone={timezone}
            top={
              <div className="flex flex-wrap items-center gap-2" aria-live="polite">
                <StatusBadge tone={view.tone}>{view.label}</StatusBadge>
                {when && !view.working ? <span className="text-sm text-muted-foreground">{formatPostTime(when, timezone)}</span> : null}
              </div>
            }
            bottom={
              view.failed || view.working ? (
                <p className={cn("text-sm", view.failed ? "text-destructive" : "text-muted-foreground")}>{view.detail}</p>
              ) : null
            }
          >
            {item.post?.status === "posted" && item.post.permalink ? (
              <a href={item.post.permalink} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
                View on Facebook
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : null}
            {view.failed && canApprove ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={async () => {
                  if (busy) return;
                  setBusy(item.id);
                  await onRetry(item);
                  setBusy(null);
                }}
              >
                <RotateCcw aria-hidden />
                {busy === item.id ? "Posting…" : "Try again"}
              </Button>
            ) : null}
          </Row>
        );
      })}
    </ul>
  );
}
