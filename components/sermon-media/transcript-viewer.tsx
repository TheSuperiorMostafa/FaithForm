"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, recordingApi, type Transcript, type TranscriptGap, type TranscriptSegment } from "@/components/sermon-media/api";
import { formatTime } from "@/components/sermon-media/time";
import { cn } from "@/lib/utils";

type Row =
  | { type: "segment"; key: string; at: number; segment: TranscriptSegment; inRange: boolean }
  | { type: "gap"; key: string; at: number; gap: TranscriptGap; inRange: boolean }
  | { type: "marker"; key: string; at: number; label: string };

function gapLabel(gap: TranscriptGap): string {
  const length = formatTime(gap.end - gap.start);
  switch (gap.reason) {
    case "music":
      return "Music";
    case "noise":
      return `Background noise for ${length}`;
    case "silence":
      return `Quiet for ${length}`;
    default:
      return `No audio for ${length}`;
  }
}

/**
 * The transcript as a list on the recording's timeline. Each line has a time
 * button that moves the player there; the line being played is highlighted;
 * the confirmed (or suggested) sermon is grouped with a side rule. "Correct
 * the transcript" turns the lines into text boxes and saves only the changed
 * ones as a new version.
 */
export function TranscriptViewer({
  recordingId,
  transcript,
  loading,
  error,
  onRetryLoad,
  range,
  currentTime,
  focusSec,
  onSeek,
  canEdit,
  onSaved,
}: {
  recordingId: string;
  transcript: Transcript | null;
  loading: boolean;
  error: string | null;
  onRetryLoad: () => void;
  range: { startSec: number; endSec: number } | null;
  currentTime: number;
  /** From a lesson's "check in the recording" link: highlight and scroll here once. */
  focusSec: number | null;
  onSeek: (seconds: number) => void;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; conflict: boolean } | null>(null);

  const segments = transcript?.segments;
  const rows = useMemo<Row[]>(() => {
    if (!transcript) return [];
    const inRange = (at: number) => Boolean(range && at >= range.startSec - 0.5 && at < range.endSec);
    const list: Row[] = [
      ...transcript.segments.map((segment) => ({
        type: "segment" as const,
        key: segment.id,
        at: segment.start,
        segment,
        inRange: inRange(segment.start),
      })),
      ...transcript.gaps
        .filter((gap) => gap.end - gap.start >= 2)
        .map((gap, index) => ({ type: "gap" as const, key: `gap-${index}`, at: gap.start, gap, inRange: inRange(gap.start) })),
    ];
    if (range) {
      list.push({ type: "marker", key: "range-start", at: range.startSec - 0.0001, label: `Sermon starts · ${formatTime(range.startSec)}` });
      list.push({ type: "marker", key: "range-end", at: range.endSec - 0.0001, label: `Sermon ends · ${formatTime(range.endSec)}` });
    }
    return list.sort((a, b) => a.at - b.at);
  }, [transcript, range]);

  const needle = query.trim().toLowerCase();
  const visibleRows = useMemo(
    () => (needle ? rows.filter((row) => row.type === "segment" && row.segment.text.toLowerCase().includes(needle)) : rows),
    [rows, needle],
  );

  const activeId = useMemo(() => {
    if (!segments) return null;
    // Segments are ordered; a short scan from a binary search point is plenty.
    let low = 0;
    let high = segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = segments[mid]!;
      if (currentTime < segment.start) high = mid - 1;
      else if (currentTime >= segment.end) low = mid + 1;
      else return segment.id;
    }
    return null;
  }, [segments, currentTime]);

  const focusId = useMemo(() => {
    if (focusSec === null || !segments) return null;
    const hit = segments.find((segment) => focusSec >= segment.start && focusSec < segment.end);
    return (hit ?? segments.find((segment) => segment.start >= focusSec) ?? null)?.id ?? null;
  }, [segments, focusSec]);

  // Keep the line being played in view inside the list (never scrolls the page).
  const followId = editing || needle ? null : (activeId ?? focusId);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !followId) return;
    const row = container.querySelector<HTMLElement>(`[data-row="${followId}"]`);
    if (!row) return;
    const top = row.offsetTop - container.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: "auto" });
    }
  }, [followId]);

  const changed = useMemo(() => {
    if (!segments) return [];
    return segments
      .filter((segment) => drafts[segment.id] !== undefined && drafts[segment.id] !== segment.text)
      .map((segment) => ({ id: segment.id, text: drafts[segment.id]!.trim() }));
  }, [segments, drafts]);

  const startEditing = () => {
    setDrafts({});
    setSaveError(null);
    setQuery("");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDrafts({});
    setSaveError(null);
  };

  const save = async () => {
    if (!transcript || changed.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await apiRequest<{ version: number }>(
      `${recordingApi(recordingId)}/transcript`,
      { method: "PATCH", body: { basedOnVersion: transcript.version, edits: changed } },
      "We couldn't save your corrections. Please try again.",
    );
    setSaving(false);
    if (!result.ok) {
      setSaveError({ message: result.error, conflict: result.status === 409 });
      return;
    }
    toast.success(
      `Saved ${changed.length} correction${changed.length === 1 ? "" : "s"} to the transcript. Lessons and clips made from these lines are marked for review.`,
    );
    setEditing(false);
    setDrafts({});
    onSaved();
  };

  const uncertainCount = useMemo(
    () => segments?.filter((segment) => segment.flags?.includes("uncertain")).length ?? 0,
    [segments],
  );

  return (
    <section
      id="transcript"
      aria-labelledby="transcript-heading"
      className="flex max-h-[min(80dvh,46rem)] min-h-[24rem] scroll-mt-24 flex-col rounded-2xl border border-border bg-card shadow-card dark:shadow-none"
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 id="transcript-heading" className="font-heading text-lg font-semibold">
              Transcript
            </h3>
            <p className="text-sm text-muted-foreground">
              {editing
                ? "Fix any words we heard wrong. Times stay the same."
                : "Press a time to play the recording from there."}
            </p>
          </div>
          {canEdit && transcript && !editing ? (
            <Button type="button" variant="outline" size="sm" onClick={startEditing} className="gap-1.5">
              <Pencil aria-hidden />
              Correct the transcript
            </Button>
          ) : null}
        </div>
        {transcript && !editing ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="transcript-search" className="sr-only">
              Search the transcript
            </Label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="transcript-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search the transcript"
                className="pl-10"
              />
            </div>
            {needle ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {visibleRows.length === 0
                  ? "No lines match."
                  : `${visibleRows.length} line${visibleRows.length === 1 ? "" : "s"} match.`}
              </p>
            ) : uncertainCount > 0 ? (
              <p className="text-sm text-muted-foreground">
                {uncertainCount} line{uncertainCount === 1 ? " was" : "s were"} hard to hear and {uncertainCount === 1 ? "is" : "are"} marked
                “unclear audio”.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-auto overflow-y-auto overscroll-contain p-3">
        {loading && !transcript ? (
          <TranscriptLinesSkeleton />
        ) : error && !transcript ? (
          <div role="alert" className="flex flex-col items-start gap-3 p-3">
            <p className="text-[15px] text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetryLoad} className="gap-1.5">
              <RotateCcw aria-hidden />
              Try again
            </Button>
          </div>
        ) : !transcript ? (
          <p className="p-3 text-[15px] text-muted-foreground">The transcript shows here once it&apos;s ready.</p>
        ) : (
          <ol className="flex flex-col" aria-label="Transcript lines">
            {visibleRows.map((row) =>
              row.type === "marker" ? (
                <li key={row.key} className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-accent">
                  {row.label}
                </li>
              ) : row.type === "gap" ? (
                <li
                  key={row.key}
                  className={cn("flex items-center gap-3 border-l-[3px] border-transparent px-3 py-1", row.inRange && "border-accent/50")}
                >
                  <TimeButton seconds={row.gap.start} onSeek={onSeek} />
                  <span className="text-sm italic text-muted-foreground">{gapLabel(row.gap)}</span>
                </li>
              ) : (
                <SegmentRow
                  key={row.key}
                  segment={row.segment}
                  inRange={row.inRange}
                  active={row.segment.id === activeId}
                  focused={row.segment.id === focusId}
                  editing={editing}
                  draft={drafts[row.segment.id]}
                  onDraft={(value) => setDrafts((current) => ({ ...current, [row.segment.id]: value }))}
                  onSeek={onSeek}
                />
              ),
            )}
          </ol>
        )}
      </div>

      {editing ? (
        <div className="flex shrink-0 flex-col gap-3 border-t border-border p-4">
          {saveError ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
              <span className="min-w-0 flex-1">{saveError.message}</span>
              {saveError.conflict ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    cancelEditing();
                    onSaved();
                  }}
                >
                  Reload the transcript
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-sm text-muted-foreground" aria-live="polite">
              {changed.length === 0 ? "No changes yet." : `${changed.length} line${changed.length === 1 ? "" : "s"} changed.`}
            </span>
            <Button type="button" variant="ghost" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={saving || changed.length === 0}>
              {saving ? "Saving…" : "Save corrections"}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TimeButton({ seconds, onSeek, label }: { seconds: number; onSeek: (seconds: number) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onSeek(seconds)}
      aria-label={`Play from ${formatTime(seconds)}${label ? `: ${label}` : ""}`}
      className="inline-flex min-h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-lg px-2 font-mono text-sm tabular-nums text-primary hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
    >
      {formatTime(seconds)}
    </button>
  );
}

const SegmentRow = memo(function SegmentRow({
  segment,
  inRange,
  active,
  focused,
  editing,
  draft,
  onDraft,
  onSeek,
}: {
  segment: TranscriptSegment;
  inRange: boolean;
  active: boolean;
  focused: boolean;
  editing: boolean;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onSeek: (seconds: number) => void;
}) {
  const flags = segment.flags ?? [];
  const unclear = flags.includes("uncertain");
  const music = flags.includes("music");
  const edited = flags.includes("edited");
  const inputId = `segment-${segment.id}`;
  return (
    <li
      data-row={segment.id}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-start gap-3 rounded-r-xl border-l-[3px] border-transparent px-3 py-1",
        inRange && "border-accent/50",
        active && "bg-accent/10",
        focused && !active && "bg-primary/[0.06] ring-1 ring-inset ring-primary/30",
      )}
    >
      <TimeButton seconds={segment.start} onSeek={onSeek} />
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-2.5">
        {editing ? (
          <>
            <Label htmlFor={inputId} className="sr-only">
              Words at {formatTime(segment.start)}
            </Label>
            <Textarea
              id={inputId}
              value={draft ?? segment.text}
              onChange={(event) => onDraft(event.target.value)}
              maxLength={4000}
              rows={2}
              className="min-h-[64px] text-[15px] leading-relaxed"
            />
          </>
        ) : (
          <p className={cn("text-[15px] leading-relaxed", music && "italic text-muted-foreground", unclear && "text-foreground/75")}>
            {segment.text}
          </p>
        )}
        {unclear || edited ? (
          <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {unclear ? <span className="rounded-full bg-muted px-2 py-0.5">unclear audio</span> : null}
            {edited ? <span className="rounded-full bg-muted px-2 py-0.5">corrected</span> : null}
          </span>
        ) : null}
      </div>
    </li>
  );
});

export function TranscriptLinesSkeleton() {
  return (
    <div className="flex flex-col" aria-hidden>
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-1">
          <span className="inline-flex min-h-11 min-w-[4.5rem] items-center justify-center">
            <Skeleton className="h-4 w-12" />
          </span>
          <div className="flex flex-1 flex-col gap-2 py-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className={cn("h-4", index % 3 === 0 ? "w-2/5" : index % 2 === 0 ? "w-4/5" : "w-3/5")} />
          </div>
        </div>
      ))}
    </div>
  );
}
