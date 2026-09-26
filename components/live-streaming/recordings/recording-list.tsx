import Link from "next/link";
import { PlayCircle, Radio, Search } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatClock } from "@/lib/stream/format";
import type { StaffRecording } from "@/lib/stream/recording-publication";
import {
  GO_LIVE_HREF,
  recordingHref,
  recordingNextAction,
  recordingTone,
  type RecordingFilter,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

/**
 * Every recording as a big row: picture, title, date, one status in the
 * canonical words, and the next thing to do as a real button. The state is
 * the point of the list — a pastor should never have to open a recording to
 * learn whether members can watch it.
 */
export function RecordingList({
  recordings,
  filter,
  search = "",
  timeZone,
  isAdmin,
}: {
  recordings: StaffRecording[];
  filter: RecordingFilter;
  search?: string;
  timeZone: string;
  isAdmin: boolean;
}) {
  if (recordings.length === 0) return <RecordingsEmpty filter={filter} search={search} />;

  return (
    <ul
      aria-label="Recordings"
      className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
    >
      {recordings.map((recording) => (
        <RecordingRow key={recording.id} recording={recording} timeZone={timeZone} isAdmin={isAdmin} />
      ))}
    </ul>
  );
}

function RecordingRow({
  recording,
  timeZone,
  isAdmin,
}: {
  recording: StaffRecording;
  timeZone: string;
  isAdmin: boolean;
}) {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(recording.recordedAt));
  const action = recordingNextAction(recording, isAdmin);
  const phase = recording.phase.phase;
  const badge = (
    <StatusBadge tone={recordingTone(phase)} className="w-fit">
      {recording.phase.label}
    </StatusBadge>
  );

  return (
    <li className="flex flex-col gap-3 p-2 sm:flex-row sm:items-center sm:gap-4">
      <Link
        href={recordingHref(recording.id)}
        className="group flex min-h-[88px] min-w-0 flex-1 items-center gap-4 rounded-2xl p-2 transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-40">
          {recording.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- church-supplied storage URL
            <img src={recording.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              {phase === "recording" ? (
                <Radio className="size-8" strokeWidth={1.5} aria-hidden />
              ) : (
                <PlayCircle className="size-8" strokeWidth={1.5} aria-hidden />
              )}
            </span>
          )}
          {recording.durationSec ? (
            <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
              {formatClock(recording.durationSec)}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="line-clamp-2 text-base font-semibold leading-snug text-foreground group-hover:underline">
            {recording.title}
          </span>
          <span className="text-[15px] text-muted-foreground">
            {date}
            {recording.seriesName ? ` · ${recording.seriesName}` : ""}
          </span>
          {phase === "needs_attention" && recording.phase.detail ? (
            <span className="line-clamp-2 text-sm text-orange-800 dark:text-orange-200">
              {recording.phase.detail}
            </span>
          ) : null}
          <span className="sm:hidden">{badge}</span>
        </span>
      </Link>
      <div className="flex shrink-0 items-center justify-end gap-3 px-2 pb-2 sm:p-0 sm:pr-3">
        <span className="hidden sm:block">{badge}</span>
        {action ? (
          // Outline on every row: a list of solid buttons is no primary at all.
          <Link href={action.href} className={cn(buttonVariants({ variant: "outline" }), "min-w-40")}>
            {action.label}
          </Link>
        ) : (
          <span className="min-w-40 text-center text-sm text-muted-foreground">Nothing to do yet</span>
        )}
      </div>
    </li>
  );
}

function RecordingsEmpty({ filter, search }: { filter: RecordingFilter; search: string }) {
  if (search) {
    return (
      <EmptyState
        icon={Search}
        title="No recordings match"
        description={`Nothing has “${search}” in its title, series or speaker. Try a shorter word.`}
      />
    );
  }
  if (filter === "published") {
    return (
      <EmptyState
        icon={PlayCircle}
        title="Nothing published yet"
        description="Publish a recording and members can watch it in the FaithForm app under Services."
      />
    );
  }
  return (
    <EmptyState
      icon={Radio}
      title="No recordings yet"
      description="Every service you stream is recorded automatically. Your first recording shows up here after you go live."
      action={
        <Link href={GO_LIVE_HREF} className={buttonVariants({ size: "lg" })}>
          Go to Go live
        </Link>
      }
    />
  );
}
