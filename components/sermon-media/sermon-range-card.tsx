"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Pencil, Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { TimeField } from "@/components/sermon-media/time-field";
import { apiRequest, recordingApi, type RangeEvidence, type SermonMediaState } from "@/components/sermon-media/api";
import { formatLength, formatTime } from "@/components/sermon-media/time";

const EVIDENCE_LABEL: Record<RangeEvidence["kind"], string> = {
  speech_block: "Long stretch of preaching",
  opening_scripture: "Scripture reading",
  opening_phrase: "Sounds like the sermon starting",
  closing_prayer: "Closing prayer",
  closing_phrase: "Sounds like the sermon ending",
  music_before: "Music before the sermon",
  music_after: "Music after the sermon",
};

function confidenceWords(confidence: number | null): string {
  if (confidence === null) return "Please check it before you confirm.";
  if (confidence >= 0.8) return "We're fairly sure. Play the start and end to check.";
  if (confidence >= 0.6) return "Please play the start and end to check it.";
  return "We're not sure. Please check it carefully.";
}

const MIN_SERMON_SEC = 60;

/**
 * Where the sermon starts and ends. Shows FaithForm's suggestion with the
 * reasons behind it, lets staff adjust it with typed times, nudges or the
 * player's position, and confirms it. A confirmed range unlocks the lesson and
 * clips; changing it later marks what was made from the old times for review.
 */
export function SermonRangeCard({
  recordingId,
  state,
  transcriptReady,
  durationSec,
  currentUserId,
  dependents,
  canEdit,
  getCurrentTime,
  onSeek,
  onPlayFrom,
  onConfirmed,
  onReload,
}: {
  recordingId: string;
  state: SermonMediaState;
  transcriptReady: boolean;
  durationSec: number | null;
  currentUserId: string;
  /** Lessons and clips already made from the confirmed range. */
  dependents: number;
  canEdit: boolean;
  getCurrentTime: () => number;
  onSeek: (seconds: number) => void;
  onPlayFrom: (from: number, until?: number) => void;
  onConfirmed: (state: SermonMediaState) => void;
  onReload: () => void;
}) {
  const { suggestion, confirmed } = state;
  const [changing, setChanging] = useState(false);
  const initial = () => ({
    start: confirmed?.startSec ?? suggestion.startSec ?? 0,
    end: confirmed?.endSec ?? suggestion.endSec ?? durationSec ?? 0,
  });
  const [start, setStart] = useState(() => initial().start);
  const [end, setEnd] = useState(() => initial().end);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; stale: boolean } | null>(null);

  // Follow the server when nobody is editing (a new suggestion, a teammate's change).
  const key = `${state.inputVersion}:${confirmed?.startSec}:${confirmed?.endSec}:${suggestion.startSec}:${suggestion.endSec}`;
  useEffect(() => {
    if (changing) return;
    const next = initial();
    setStart(next.start);
    setEnd(next.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const max = durationSec ?? undefined;
  const editing = canEdit && transcriptReady && (!confirmed || changing);
  const lengthProblem =
    end <= start
      ? "The sermon has to end after it starts."
      : end - start < MIN_SERMON_SEC
        ? "The sermon has to be at least a minute long."
        : null;

  const confirm = async () => {
    if (lengthProblem || saving) return;
    if (confirmed && dependents > 0) {
      const ok = await confirmAction({
        title: "Change the sermon times?",
        description: `Lessons and clips made from the old times (${dependents}) will be marked “Needs review” so you can check them.`,
        confirmLabel: "Change sermon times",
      });
      if (!ok) return;
    }
    setSaving(true);
    setProblem(null);
    const result = await apiRequest<{ state: SermonMediaState }>(
      `${recordingApi(recordingId)}/range`,
      { method: "POST", body: { startSec: start, endSec: end, expectedInputVersion: state.inputVersion } },
      "We couldn't save the sermon times. Please try again.",
    );
    setSaving(false);
    if (!result.ok) {
      setProblem({ message: result.error, stale: result.status === 409 });
      return;
    }
    setChanging(false);
    toast.success(`Sermon times saved: ${formatTime(start)} – ${formatTime(end)}. You can now make a lesson and clips.`);
    onConfirmed(result.data.state);
  };

  const evidence = suggestion.evidence ?? [];
  const hasSuggestion = suggestion.status === "suggested" && suggestion.startSec !== null && suggestion.endSec !== null;

  return (
    <section
      aria-labelledby="sermon-range-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id="sermon-range-heading" className="font-heading text-lg font-semibold">
            {confirmed && !changing
              ? "Sermon times"
              : hasSuggestion
                ? "Check the sermon times"
                : "Choose where the sermon starts and ends"}
          </h3>
          {!transcriptReady ? (
            <p className="text-[15px] text-muted-foreground">
              Once the transcript is ready, we&apos;ll suggest where the sermon starts and ends.
            </p>
          ) : confirmed && !changing ? (
            <p className="text-[15px]">
              The sermon runs{" "}
              <strong className="font-semibold tabular-nums">
                {formatTime(confirmed.startSec)} – {formatTime(confirmed.endSec)}
              </strong>{" "}
              ({formatLength(confirmed.endSec - confirmed.startSec)}).
            </p>
          ) : hasSuggestion ? (
            <p className="text-[15px]">
              We think the sermon runs{" "}
              <strong className="font-semibold tabular-nums">
                {formatTime(suggestion.startSec!)} – {formatTime(suggestion.endSec!)}
              </strong>
              . {confidenceWords(suggestion.confidence)}
            </p>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              We couldn&apos;t tell for sure from the recording. Play it, then set the start and end below.
            </p>
          )}
        </div>
        {confirmed && !changing ? (
          <StatusBadge tone="done">
            <CheckCircle2 className="size-4" aria-hidden />
            Confirmed
          </StatusBadge>
        ) : transcriptReady ? (
          <StatusBadge tone="attention">Needs your check</StatusBadge>
        ) : null}
      </div>

      {confirmed && !changing ? (
        <>
          <p className="text-sm text-muted-foreground">
            Confirmed {new Date(confirmed.at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            {confirmed.by ? (confirmed.by === currentUserId ? " by you" : " by a teammate") : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onPlayFrom(confirmed.startSec, confirmed.startSec + 20)} className="gap-1.5">
              <Play aria-hidden />
              Play the start
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onPlayFrom(Math.max(confirmed.startSec, confirmed.endSec - 20), confirmed.endSec)}
              className="gap-1.5"
            >
              <Play aria-hidden />
              Play the end
            </Button>
            {canEdit ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(true)} className="gap-1.5">
                <Pencil aria-hidden />
                Change
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {transcriptReady && evidence.length > 0 && (!confirmed || changing) ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-[15px] font-semibold">Why we think so</h4>
          <ul className="flex flex-col gap-1">
            {evidence.slice(0, 8).map((item, index) => (
              <li key={`${item.kind}-${index}`} className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onSeek(item.atSec)}
                  aria-label={`Go to ${formatTime(item.atSec)}: ${EVIDENCE_LABEL[item.kind]}`}
                  className="inline-flex min-h-11 min-w-[4.5rem] shrink-0 items-center justify-center rounded-lg px-2 font-mono text-sm tabular-nums text-primary hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-accent"
                >
                  {formatTime(item.atSec)}
                </button>
                <span className="min-w-0 py-2.5 text-[15px]">
                  <span className="font-medium">{EVIDENCE_LABEL[item.kind]}</span>
                  {item.text ? <span className="text-muted-foreground"> — “{item.text}”</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-4 border-t border-border pt-5">
          <TimeField
            label="Sermon starts"
            value={start}
            max={max}
            onChange={setStart}
            onUseCurrent={() => setStart(Math.floor(getCurrentTime()))}
            onPreview={() => onPlayFrom(start, start + 20)}
            previewLabel="Play the start"
          />
          <TimeField
            label="Sermon ends"
            value={end}
            max={max}
            onChange={setEnd}
            onUseCurrent={() => setEnd(Math.ceil(getCurrentTime()))}
            onPreview={() => onPlayFrom(Math.max(0, end - 20), end)}
            previewLabel="Play the end"
          />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {lengthProblem ?? `The sermon is ${formatLength(end - start)} long.`}
          </p>
          {problem ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
              <span className="min-w-0 flex-1">{problem.message}</span>
              {problem.stale ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setChanging(false);
                    setProblem(null);
                    onReload();
                  }}
                >
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => void confirm()} disabled={saving || Boolean(lengthProblem)}>
              {saving ? "Saving…" : "Confirm sermon times"}
            </Button>
            {changing ? (
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setChanging(false);
                  setProblem(null);
                  setStart(confirmed?.startSec ?? start);
                  setEnd(confirmed?.endSec ?? end);
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
