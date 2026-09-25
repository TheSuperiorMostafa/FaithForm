import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A big, labelled launchpad tile: icon + short verb phrase + one line of
 * context. The whole card is the target. Stacked vertically so titles never
 * squeeze, whatever the column width.
 */
export function ActionCard({
  href,
  icon: Icon,
  title,
  description,
  tone = "default",
  className,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  tone?: "default" | "primary";
  className?: string;
  /** e.g. a count of things waiting. */
  badge?: React.ReactNode;
}) {
  const primary = tone === "primary";
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex min-h-[152px] flex-col justify-between gap-5 rounded-2xl border p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:p-6",
        primary
          ? "border-transparent bg-primary text-primary-foreground dark:border-accent/40 dark:bg-accent/15 dark:text-foreground"
          : "border-border bg-card text-card-foreground hover:border-accent/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-14 shrink-0 items-center justify-center rounded-2xl transition-colors",
            primary
              ? "bg-white/10 text-accent dark:bg-accent/20"
              : "bg-primary/[0.06] text-primary group-hover:bg-accent/15 dark:bg-accent/15 dark:text-accent",
          )}
        >
          <Icon className="size-7" strokeWidth={1.75} />
        </span>
        {badge}
        <ArrowRight
          aria-hidden
          className={cn(
            "mt-1 size-5 shrink-0 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none",
            primary ? "text-primary-foreground/70 dark:text-accent" : "text-muted-foreground",
          )}
        />
      </div>
      <span className="space-y-1">
        <span className="block font-heading text-lg font-bold leading-snug">{title}</span>
        {description && (
          <span
            className={cn(
              "block text-[15px] leading-snug",
              primary ? "text-primary-foreground/80 dark:text-muted-foreground" : "text-muted-foreground",
            )}
          >
            {description}
          </span>
        )}
      </span>
    </Link>
  );
}

export function ActionGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Flex, not grid: each card is measured at its own width, so wrapped text
    // never spills past the card (see .choice-grid in globals.css).
    <div className={cn("choice-grid choice-grid-3 gap-4", className)}>{children}</div>
  );
}
