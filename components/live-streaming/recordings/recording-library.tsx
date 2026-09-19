import Link from "next/link";
import { PlayCircle, Radio } from "lucide-react";

import { RecordingPhaseBadge } from "@/components/live-streaming/recordings/recording-phase-badge";
import { buttonVariants } from "@/components/ui/button";
import { formatClock } from "@/lib/stream/format";
import type { RecordingPhase } from "@/lib/stream/recording-model";
import type { StaffRecording } from "@/lib/stream/recording-publication";

/**
 * Every livestream's recording, grouped by what — if anything — the church
 * needs to do about it. Never a list of provider assets.
 */
const SECTIONS: Array<{ phases: RecordingPhase[]; title: string; hint?: string }> = [
  { phases: ["needs_attention"], title: "Needs attention" },
  { phases: ["ready_to_publish"], title: "Ready to publish", hint: "Watch it, check the details, and publish." },
  { phases: ["recording", "preparing"], title: "Preparing", hint: "FaithForm is getting these ready. Nothing to do yet." },
  { phases: ["published"], title: "Published" },
  { phases: ["unpublished"], title: "Not published", hint: "Taken out of the app and website. Still saved." },
];

export function RecordingLibrary({
  recordings,
  timeZone,
}: {
  recordings: StaffRecording[];
  timeZone: string;
}) {
  if (recordings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-16 text-center">
        <Radio className="size-10 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <h2 className="font-heading text-xl font-semibold">No recordings yet</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Every livestream is recorded automatically. Your first recording will appear here after you go live.
        </p>
        <Link href="/dashboard/live-streaming" className={buttonVariants()}>
          Go to Broadcast
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {SECTIONS.map((section) => {
        const items = recordings.filter((recording) => section.phases.includes(recording.phase.phase));
        if (items.length === 0) return null;
        const id = `recordings-${section.phases[0]}`;
        return (
          <section key={section.title} aria-labelledby={id} className="flex flex-col gap-3">
            <div>
              <h2 id={id} className="font-heading text-lg font-semibold">
                {section.title} <span className="text-muted-foreground">({items.length})</span>
              </h2>
              {section.hint ? <p className="text-sm text-muted-foreground">{section.hint}</p> : null}
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((recording) => (
                <li key={recording.id}>
                  <RecordingCard recording={recording} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function RecordingCard({ recording, timeZone }: { recording: StaffRecording; timeZone: string }) {
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(new Date(recording.recordedAt));

  return (
    <Link
      href={`/dashboard/live-streaming/recordings/${recording.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none"
    >
      <div className="relative aspect-video bg-muted">
        {recording.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recording.posterUrl} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <PlayCircle className="size-10" strokeWidth={1.5} aria-hidden />
          </div>
        )}
        {recording.durationSec ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
            {formatClock(recording.durationSec)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <RecordingPhaseBadge phase={recording.phase.phase} label={recording.phase.label} className="w-fit" />
        <p className="font-semibold leading-snug group-hover:underline">{recording.title}</p>
        <p className="text-sm text-muted-foreground">{date}</p>
        {recording.phase.phase === "needs_attention" && recording.phase.detail ? (
          <p className="text-sm text-red-700 dark:text-red-300">{recording.phase.detail}</p>
        ) : null}
      </div>
    </Link>
  );
}
