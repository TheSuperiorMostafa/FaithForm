import Link from "next/link";
import { Clapperboard } from "lucide-react";

import {
  RECORDING_FILTERS,
  recordingFilterHref,
  type RecordingFilter,
} from "@/lib/stream/recording-status";
import { CLIPS_HREF } from "@/lib/sermon-media/hrefs";
import { cn } from "@/lib/utils";

import { RecordingSearch } from "./recording-search";

const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";
const CHIP_ON = "border-primary bg-primary text-primary-foreground";
const CHIP_OFF = "border-border bg-card text-foreground/80 hover:border-accent/60 hover:text-foreground";

/**
 * All · Published · Series, with a search box beside them on the lists, and
 * Clips (the clips made from these recordings, waiting for approval) when the
 * church has Transcripts & Clips. Links, not client state, so a filtered view
 * can be bookmarked and the back button works.
 */
export function RecordingFilters({
  active,
  counts,
  search,
  showClips = false,
}: {
  active: RecordingFilter | "clips";
  /** Show the Clips view link (Transcripts & Clips is on and allowed). */
  showClips?: boolean;
  /** The current search; omitted where there is no search box (Series). */
  search?: string;
  /** Omitted for a filter whose count isn't known (Series). */
  counts?: Partial<Record<RecordingFilter, number>>;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Show recordings" className="flex flex-wrap gap-2">
        {RECORDING_FILTERS.map((filter) => {
          const selected = filter.key === active;
          const count = counts?.[filter.key];
          return (
            <Link
              key={filter.key}
              href={recordingFilterHref(filter.key, search)}
              aria-current={selected ? "page" : undefined}
              className={cn(CHIP, selected ? CHIP_ON : CHIP_OFF)}
            >
              {filter.label}
              {count !== undefined ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-sm tabular-nums",
                    selected ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
        {showClips || active === "clips" ? (
          <Link
            href={CLIPS_HREF}
            aria-current={active === "clips" ? "page" : undefined}
            className={cn(CHIP, active === "clips" ? CHIP_ON : CHIP_OFF)}
          >
            <Clapperboard className="size-4" aria-hidden />
            Clips
          </Link>
        ) : null}
      </nav>
      {search !== undefined ? <RecordingSearch initial={search} /> : null}
    </div>
  );
}
