"use client";

import * as React from "react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * For the moments that matter (checked in, released, sent, published):
 * what happened, where it went, and what to do next. Announced to screen
 * readers. Use toasts for small things; use this for big ones.
 */
export function SuccessState({
  title,
  description,
  children,
  actions,
  className,
  autoFocus = true,
}: {
  title: string;
  description?: React.ReactNode;
  /** Extra content, e.g. a pickup code in large type. */
  children?: React.ReactNode;
  /** Next steps: View · Undo · Done. */
  actions?: React.ReactNode;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-5 rounded-3xl border border-emerald-200 bg-emerald-50/70 px-6 py-10 text-center outline-none dark:border-emerald-500/30 dark:bg-emerald-500/10",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm"
      >
        <CheckCircle2 className="size-9" strokeWidth={2} />
      </span>
      <div className="max-w-lg space-y-2">
        <h2 className="font-heading text-2xl font-bold text-foreground">{title}</h2>
        {description && (
          <p className="text-base leading-relaxed text-foreground/80">{description}</p>
        )}
      </div>
      {children}
      {actions && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
