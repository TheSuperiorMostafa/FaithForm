import Link from "next/link";

import {
  RECORDING_FILTERS,
  recordingFilterHref,
  type RecordingFilter,
} from "@/lib/stream/recording-status";
import { cn } from "@/lib/utils";

/**
 * All · Needs action · Published · Series. Links, not client state, so a
 * filtered view can be bookmarked and the back button works.
 */
export function RecordingFilters({
  active,
  counts,
}: {
  active: RecordingFilter;
  /** Omitted for a filter whose count isn't known (Series). */
  counts?: Partial<Record<RecordingFilter, number>>;
}) {
  return (
    <nav aria-label="Show recordings" className="flex flex-wrap gap-2">
      {RECORDING_FILTERS.map((filter) => {
        const selected = filter.key === active;
        const count = counts?.[filter.key];
        return (
          <Link
            key={filter.key}
            href={recordingFilterHref(filter.key)}
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
                  filter.key === "needs-action" && count > 0 && !selected && "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
