import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "No groups yet" + one line on what the area is for + one create button.
 * Never "No data". A failed load is not an empty state: use ErrorState.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Inside a card or panel rather than a whole page. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact
          ? "gap-3 rounded-2xl border border-dashed border-border px-6 py-10"
          : "gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-16",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-2xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent",
          compact ? "size-12" : "size-16",
        )}
      >
        <Icon className={compact ? "size-6" : "size-8"} strokeWidth={1.5} />
      </span>
      <div className="max-w-md space-y-1.5">
        <h3 className={cn("font-heading font-bold text-foreground", compact ? "text-lg" : "text-xl")}>
          {title}
        </h3>
        {description && (
          <p className="text-[15px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}
