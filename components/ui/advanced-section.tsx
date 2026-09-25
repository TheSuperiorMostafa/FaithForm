"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Progressive disclosure, one level only. Holds options most churches never
 * need. Opens itself when something inside it is invalid, so an error is
 * never hidden in a collapsed section.
 */
export function AdvancedSection({
  title = "More options",
  description,
  children,
  defaultOpen = false,
  forceOpen = false,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Pass true when a field inside has an error. */
  forceOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen || forceOpen);
  const ref = React.useRef<HTMLDivElement>(null);
  const contentId = React.useId();

  React.useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  // Open on native validation failure of any field inside.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onInvalid = () => setOpen(true);
    el.addEventListener("invalid", onInvalid, true);
    return () => el.removeEventListener("invalid", onInvalid, true);
  }, []);

  return (
    <div ref={ref} className={cn("rounded-2xl border border-border bg-card/50", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="space-y-0.5">
          <span className="block text-[15px] font-semibold text-foreground">{title}</span>
          {description && (
            <span className="block text-sm text-muted-foreground">{description}</span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {/* Kept mounted so form fields inside still submit while collapsed. */}
      <div id={contentId} hidden={!open} className="space-y-5 border-t border-border px-5 py-5">
        {children}
      </div>
    </div>
  );
}
