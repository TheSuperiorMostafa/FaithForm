"use client";

import { useEffect, useState } from "react";
import { Pencil, Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
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

const MIN_SERMON_SEC = 60;

/**
 * Where the sermon starts and ends. FaithForm finds it by itself and uses it
 * straight away (or the whole recording when it can't tell); nothing waits
 * for anyone to confirm it. Staff can still move it with typed times, the
 * player's position or a preview, and moving it marks lessons and clips made
 * from the old times for review.
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
  /** Lessons and clips already made from the current range. */
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
  // What FaithForm uses: the saved range, else what it detected, else the whole recording.
  const detected =
    suggestion.startSec !== null && suggestion.endSec !== null && suggestion.endSec > suggestion.startSec
      ? { startSec: suggestion.startSec, endSec: suggestion.endSec }
      : null;
  const whole = durationSec && durationSec > 0 ? { startSec: 0, endSec: durationSec } : null;
  const current = confirmed ?? detected ?? whole;
  const initial = () => ({ start: current?.startSec ?? 0, end: current?.endSec ?? 0 });
  const [start, setStart] = useState(() => initial().start);
  const [end, setEnd] = useState(() => initial().end);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; stale: boolean } | null>(null);

  // Follow the server when nobody is editing (a new suggestion, a teammate's change).
  const key = `${state.inputVersion}:${current?.startSec}:${current?.endSec}`;
  useEffect(() => {
    if (changing) return;
    const next = initial();
    setStart(next.start);
    setEnd(next.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const max = durationSec ?? undefined;
  const editing = canEdit && transcriptReady && changing;
  const lengthProblem =
    end <= start
      ? "The sermon has to end after it starts."
      : end - start < MIN_SERMON_SEC
        ? "The sermon has to be at least a minute long."
        : null;

  const save = async () => {
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
    toast.success(`Sermon times saved: ${formatTime(start)} – ${formatTime(end)}.`);
    onConfirmed(result.data.state);
  };

  const evidence = suggestion.evidence ?? [];
  const setByPerson = Boolean(confirmed && !confirmed.automatic && confirmed.by);
  const isWhole = Boolean(
    current &&
      !setByPerson &&
      ((!confirmed && !detected) || (current.startSec === 0 && durationSec && current.endSec >= durationSec - 1 && !detected)),
  );

  return (
    <section
      aria-labelledby="sermon-range-heading"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
    >
      <div className="min-w-0 space-y-1">
        <h3 id="sermon-range-heading" className="font-heading text-lg font-semibold">
          Sermon times
        </h3>
        {!transcriptReady ? (
          <p className="text-[15px] text-muted-foreground">
            Once the transcript is ready, FaithForm finds where the sermon starts and ends.
          </p>
        ) : current ? (
          <p className="text-[15px]">
            The sermon runs{" "}
            <strong className="font-semibold tabular-nums">
              {formatTime(current.startSec)} – {formatTime(current.endSec)}
            </strong>{" "}
            ({formatLength(current.endSec - current.startSec)}).{" "}
            <span className="text-muted-foreground">
              {isWhole
                ? "FaithForm couldn't tell where it starts, so it uses the whole recording."
                : setByPerson
                  ? `Set ${confirmed!.by === currentUserId ? "by you" : "by a teammate"}.`
                  : "Found automatically."}
            </span>
          </p>
        ) : (
          <p className="text-[15px] text-muted-foreground">FaithForm uses the whole recording.</p>
        )}
      </div>

      {transcriptReady && current && !changing ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onPlayFrom(current.startSec, current.startSec + 20)} className="gap-1.5">
            <Play aria-hidden />
            Play the start
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPlayFrom(Math.max(current.startSec, current.endSec - 20), current.endSec)}
            className="gap-1.5"
          >
            <Play aria-hidden />
            Play the end
          </Button>
          {canEdit ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setChanging(true)} className="gap-1.5">
              <Pencil aria-hidden />
              Change times
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing && evidence.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-[15px] font-semibold">What FaithForm noticed</h4>
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
            <Button type="button" onClick={() => void save()} disabled={saving || Boolean(lengthProblem)}>
              {saving ? "Saving…" : "Save sermon times"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setChanging(false);
                setProblem(null);
                setStart(current?.startSec ?? start);
                setEnd(current?.endSec ?? end);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
