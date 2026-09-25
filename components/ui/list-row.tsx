import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The big, scannable row used instead of spreadsheet tables for people,
 * groups, recordings, calls, families. One leading visual, a name, one line
 * of context, one status, and the whole row as the target.
 *
 * Use a real <table> only where people compare columns, sort, or export.
 */
export function ListRow({
  href,
  onClick,
  leading,
  title,
  subtitle,
  status,
  trailing,
  selected = false,
  className,
  "aria-label": ariaLabel,
}: {
  href?: string;
  onClick?: () => void;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  /** Extra actions; rendered outside the main target so they stay separate. */
  trailing?: React.ReactNode;
  selected?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const body = (
    <>
      {leading && <span className="shrink-0">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-foreground">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">{subtitle}</span>
        )}
      </span>
      {status && <span className="shrink-0">{status}</span>}
      {(href || onClick) && (
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      )}
    </>
  );

  const targetClass =
    "flex min-h-[72px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-3 py-3 sm:gap-4 sm:px-4 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-2xl",
        selected && "bg-accent/10 ring-1 ring-accent/40",
        className,
      )}
    >
      {href ? (
        <Link href={href} className={targetClass} aria-label={ariaLabel} aria-current={selected || undefined}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={targetClass} aria-label={ariaLabel} aria-pressed={selected}>
          {body}
        </button>
      ) : (
        <div className={cn(targetClass, "hover:bg-transparent")}>{body}</div>
      )}
      {trailing && <div className="flex shrink-0 items-center gap-2 pr-3">{trailing}</div>}
    </li>
  );
}

/** A card holding ListRows with dividers. */
export function List({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm",
        className,
      )}
    >
      {children}
    </ul>
  );
}

/** Round initials avatar, used when there is no photo. */
export function InitialsAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 items-center justify-center rounded-full bg-primary/[0.08] font-heading text-base font-bold text-primary dark:bg-accent/15 dark:text-accent",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
