"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Captions, ChevronLeft, ChevronRight, Clapperboard, Radio, RotateCcw, Search, Upload, Video } from "lucide-react";
import { toast } from "sonner";

import { JobProgress } from "@/components/sermon-media/job-progress";
import {
  apiRequest,
  isJobActive,
  recordingApi,
  type LibraryItem,
  type LibraryPage,
  type PublicJob,
} from "@/components/sermon-media/api";
import { formatLength, formatTime } from "@/components/sermon-media/time";
import { canStartTranscript, transcriptStatus } from "@/components/transcripts/status";
import {
  LIBRARY_DESCRIPTION,
  LIBRARY_TITLE,
  LibraryRowsSkeleton,
  ROW,
  SEARCH_BOX,
} from "@/components/transcripts/transcript-library-skeleton";
import { UploadVideoDialog } from "@/components/transcripts/upload-video-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRecordingDate } from "@/lib/stream/recording-date";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const CLIPS_HREF = "/dashboard/clips";
export const transcriptHref = (recordingId: string) => `/dashboard/transcripts/${recordingId}`;

/**
 * The Transcripts section: every service and uploaded video, newest first,
 * with live progress while FaithForm works. Rows update in place every five
 * seconds while anything is being transcribed or prepared, and stop checking
 * when nothing is.
 */
export function TranscriptLibrary({
  isAdmin,
  timeZone,
  today,
  autoTranscribe,
  initialQuery,
  initialPage,
}: {
  isAdmin: boolean;
  timeZone: string;
  /** Today in the church's time zone (yyyy-mm-dd), the upload's default date. */
  today: string;
  autoTranscribe: boolean;
  initialQuery: string;
  initialPage: number;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(initialPage);
  const [data, setData] = useState<LibraryPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [starting, setStarting] = useState<Set<string>>(() => new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const sequence = useRef(0);
  const activeIds = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (target: { page: number; query: string }, mode: "switch" | "silent") => {
      const id = ++sequence.current;
      if (mode === "switch") setSwitching(true);
      const params = new URLSearchParams({ page: String(target.page) });
      if (target.query) params.set("q", target.query);
      const result = await apiRequest<LibraryPage>(
        `/api/sermon-media/library?${params}`,
        {},
        "We couldn't load your transcripts.",
      );
      // A newer request (typing, paging) has started: this answer is stale.
      if (id !== sequence.current) return;
      setSwitching(false);
      if (result.ok) {
        setData(result.data);
        setLoadError(null);
      } else if (mode === "switch") {
        setLoadError(result.error);
      }
    },
    [],
  );

  // Load whenever the page or the search changes, and keep the address in step.
  useEffect(() => {
    void load({ page, query }, "switch");
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    window.history.replaceState(window.history.state, "", search ? `?${search}` : window.location.pathname);
  }, [page, query, load]);

  // Typing: search a moment after the last key.
  useEffect(() => {
    const next = typed.trim();
    if (next === query) return;
    const timer = window.setTimeout(() => {
      setQuery(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [typed, query]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const needsPolling = items.some((item) => isJobActive(item.job) || item.recordingStatus === "processing");
  useEffect(() => {
    if (!needsPolling) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load({ page, query }, "silent");
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [needsPolling, page, query, load]);

  // Say so when a transcript finishes while the page is open.
  useEffect(() => {
    const nowActive = new Set(items.filter((item) => isJobActive(item.job)).map((item) => item.id));
    for (const item of items) {
      if (activeIds.current.has(item.id) && !nowActive.has(item.id) && item.transcript === "ready") {
        const id = item.id;
        toast.success(`“${item.title || "Untitled service"}” is transcribed.`, {
          action: { label: "Open", onClick: () => router.push(transcriptHref(id)) },
        });
      }
    }
    activeIds.current = nowActive;
  }, [items, router]);

  const start = async (item: LibraryItem) => {
    setStarting((current) => new Set(current).add(item.id));
    const result = await apiRequest<{ job: PublicJob }>(
      `${recordingApi(item.id)}/transcribe`,
      { method: "POST", body: {} },
      "We couldn't start the transcript. Please try again.",
    );
    setStarting((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Transcribing “${item.title || "Untitled service"}”. You can follow it here or leave this page.`);
    const job = result.data.job;
    setData((current) =>
      current
        ? { ...current, items: current.items.map((row) => (row.id === item.id ? { ...row, job, transcript: job.status } : row)) }
        : current,
    );
  };

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastShown = Math.min(total, page * pageSize);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={LIBRARY_TITLE}
        description={LIBRARY_DESCRIPTION}
        icon={Captions}
        action={
          isAdmin ? (
            <Button size="lg" onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden />
              Upload a video
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className={SEARCH_BOX} role="search">
            <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Find a service"
              aria-label="Find a service by title"
              className="pl-12"
            />
          </div>
          <p className="min-h-5 text-[15px] text-muted-foreground" aria-live="polite">
            {data === null
              ? null
              : total === 0
                ? null
                : total <= pageSize
                  ? `${total} service${total === 1 ? "" : "s"} and video${total === 1 ? "" : "s"}`
                  : `Showing ${firstShown}–${lastShown} of ${total}`}
          </p>
        </div>

        {data === null && loadError === null ? (
          <div role="status" aria-busy="true" aria-label="Loading transcripts">
            <LibraryRowsSkeleton />
          </div>
        ) : loadError !== null && data === null ? (
          <ErrorState
            title="Your transcripts didn't load"
            description={`${loadError} Nothing was lost.`}
            onRetry={() => void load({ page, query }, "switch")}
          />
        ) : items.length === 0 ? (
          query ? (
            <EmptyState
              icon={Search}
              title={`Nothing matches “${query}”`}
              description="Try another word from the service's title."
              action={
                <Button variant="outline" onClick={() => setTyped("")}>
                  Clear the search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Captions}
              title="No transcripts yet"
              description={
                autoTranscribe
                  ? "After each livestream, FaithForm writes out the whole service by itself and it shows up here. You can also upload a video of a service."
                  : "Your livestreamed services show up here, ready to transcribe. You can also upload a video of a service."
              }
              action={
                isAdmin ? (
                  <Button onClick={() => setUploadOpen(true)}>
                    <Upload aria-hidden />
                    Upload a video
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <>
            {loadError ? (
              <p role="alert" className="rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
                {loadError}
              </p>
            ) : null}
            <ul
              aria-label="Services and videos"
              aria-busy={switching}
              className={cn(
                "divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm transition-opacity",
                switching && "opacity-60",
              )}
            >
              {items.map((item) => (
                <TranscriptRow
                  key={item.id}
                  item={item}
                  timeZone={timeZone}
                  starting={starting.has(item.id)}
                  onStart={() => void start(item)}
                />
              ))}
            </ul>
          </>
        )}

        {pages > 1 ? (
          <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" disabled={page <= 1 || switching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
              <ChevronLeft aria-hidden />
              Newer
            </Button>
            <span className="text-[15px] text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button variant="outline" disabled={page >= pages || switching} onClick={() => setPage((current) => Math.min(pages, current + 1))}>
              Older
              <ChevronRight aria-hidden />
            </Button>
          </nav>
        ) : null}
      </div>

      {isAdmin ? (
        <UploadVideoDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          defaultServiceDate={today}
          autoTranscribe={autoTranscribe}
          onUploaded={() => {
            setTyped("");
            if (page === 1 && query === "") void load({ page: 1, query: "" }, "switch");
            else {
              setQuery("");
              setPage(1);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function TranscriptRow({
  item,
  timeZone,
  starting,
  onStart,
}: {
  item: LibraryItem;
  timeZone: string;
  starting: boolean;
  onStart: () => void;
}) {
  const title = item.title || "Untitled service";
  const kind = transcriptStatus({
    recordingStatus: item.recordingStatus,
    transcriptReady: item.transcript === "ready",
    job: item.job,
  });
  const date = formatRecordingDate(item.createdAt, timeZone, item.serviceDate);
  const SourceIcon = item.source === "upload" ? Video : Radio;

  return (
    <li className={ROW.item}>
      <Link href={transcriptHref(item.id)} className={ROW.link} aria-label={`Open the transcript of ${title}, ${date}`}>
        <span aria-hidden className={ROW.icon}>
          <SourceIcon className="size-5" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[15px] text-muted-foreground">
            <span>{date}</span>
            {item.durationSec ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatLength(item.durationSec)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{item.source === "upload" ? "Uploaded" : "Livestream"}</span>
          </span>
        </span>
      </Link>

      <div className={ROW.side}>
        <div className={ROW.status}>
          {kind === "working" && item.job?.progressView ? (
            <JobProgress compact progress={item.job.progressView} />
          ) : kind === "working" ? (
            <StatusBadge tone="working" className="w-fit">
              Transcribing
            </StatusBadge>
          ) : kind === "ready" ? (
            <>
              <StatusBadge tone="done" className="w-fit">
                Ready
              </StatusBadge>
              <span className="truncate text-sm text-muted-foreground">
                {item.sermon
                  ? `Sermon ${formatTime(item.sermon.startSec)}–${formatTime(item.sermon.endSec)}${item.sermon.automatic ? " · found automatically" : ""}`
                  : "Sermon times not chosen yet"}
              </span>
            </>
          ) : kind === "preparing" ? (
            <>
              <StatusBadge tone="working" className="w-fit">
                Getting the video ready
              </StatusBadge>
              <span className="truncate text-sm text-muted-foreground">Transcribing comes next</span>
            </>
          ) : kind === "video_problem" ? (
            <>
              <StatusBadge tone="attention" className="w-fit">
                Video problem
              </StatusBadge>
              <span className="truncate text-sm text-muted-foreground">The video couldn&apos;t be prepared</span>
            </>
          ) : kind === "failed" ? (
            <>
              <StatusBadge tone="attention" className="w-fit">
                Couldn&apos;t finish
              </StatusBadge>
              <span className="truncate text-sm text-muted-foreground">Nothing was lost. Try again.</span>
            </>
          ) : (
            <>
              <StatusBadge tone="neutral" className="w-fit">
                {kind === "stopped" ? "Stopped" : "Not transcribed"}
              </StatusBadge>
              <span className="truncate text-sm text-muted-foreground">
                {kind === "stopped" ? "Stopped before it finished" : "Ready to transcribe"}
              </span>
            </>
          )}
        </div>

        <div className={ROW.action}>
          {canStartTranscript(kind) ? (
            <Button
              size="sm"
              variant={kind === "failed" ? "outline" : "default"}
              disabled={starting}
              onClick={onStart}
              aria-label={`${kind === "failed" ? "Try again" : "Transcribe"}: ${title}`}
            >
              {kind === "failed" ? <RotateCcw aria-hidden /> : <Captions aria-hidden />}
              {starting ? "Starting…" : kind === "failed" ? "Try again" : "Transcribe"}
            </Button>
          ) : item.clips.total > 0 ? (
            <Link
              href={CLIPS_HREF}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold text-primary hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
              aria-label={`${item.clips.total} clip${item.clips.total === 1 ? "" : "s"} from ${title}: open Clips`}
            >
              <Clapperboard aria-hidden className="size-4" />
              {item.clips.total} clip{item.clips.total === 1 ? "" : "s"}
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}
