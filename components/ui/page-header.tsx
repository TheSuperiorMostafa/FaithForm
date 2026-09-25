import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Every dashboard page opens with this. The title names the page (and matches
 * the sidebar label), the description is one plain sentence, and `action` is
 * the page's one primary button. Secondary actions go in `secondary` and must
 * use outline/ghost buttons so nothing competes with the main job.
 *
 * Static text: renders real text in loading states too (static-first rule).
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  secondary,
  className,
  as: Heading = "h1",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** The one primary action for this page. */
  action?: React.ReactNode;
  /** Quieter actions (outline/ghost). */
  secondary?: React.ReactNode;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <span
            aria-hidden
            className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/[0.07] text-primary sm:flex dark:bg-accent/15 dark:text-accent"
          >
            <Icon className="size-6" strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0 space-y-1.5">
          <Heading className="font-heading text-[28px] font-bold leading-tight text-foreground sm:text-[32px]">
            {title}
          </Heading>
          {description && (
            <div className="max-w-2xl text-base leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
        </div>
      </div>
      {(action || secondary) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {secondary}
          {action}
        </div>
      )}
    </header>
  );
}

/** A section heading inside a page: quieter than the page title. */
export function SectionHeader({
  title,
  description,
  action,
  className,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="space-y-1">
        <h2 id={id} className="font-heading text-xl font-bold text-foreground">
          {title}
        </h2>
        {description && <div className="text-[15px] text-muted-foreground">{description}</div>}
      </div>
      {action}
    </div>
  );
}
