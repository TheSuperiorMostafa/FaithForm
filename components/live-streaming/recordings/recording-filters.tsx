import Link from "next/link";

import {
  RECORDING_FILTERS,
  recordingFilterHref,
  type RecordingFilter,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

import { RecordingSearch } from "./recording-search";

/**
 * All · Published · Series, with a search box beside them on the lists.
 * Links, not client state, so a filtered view can be bookmarked and the back
 * button works.
 */
export function RecordingFilters({
  active,
  counts,
  search,
}: {
  active: RecordingFilter;
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
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground/80 hover:border-accent/60 hover:text-foreground",
              )}
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
      </nav>
      {search !== undefined ? <RecordingSearch initial={search} /> : null}
    </div>
  );
}
