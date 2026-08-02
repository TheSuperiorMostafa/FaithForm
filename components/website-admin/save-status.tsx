"use client";

import { Check, CircleAlert, Loader2 } from "lucide-react";

import type { AutosaveStatus } from "@/components/website-admin/use-autosave";
import { cn } from "@/lib/utils";

/**
 * The only feedback an autosaving form gives, so it has to be honest.
 *
 * "Pending" is shown as *unsaved*, not as saved-already — telling someone their
 * work is safe a moment before it actually is, is the one thing a save
 * indicator must never do.
 */
export function SaveStatus({
  status,
  className,
}: {
  status: AutosaveStatus;
  className?: string;
}) {
  const base = "inline-flex items-center gap-1.5 text-xs";

  switch (status.kind) {
    case "pending":
      return (
        <span className={cn(base, "text-muted-foreground", className)}>
          <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
          Unsaved changes
        </span>
      );
    case "saving":
      return (
        <span className={cn(base, "text-muted-foreground", className)} role="status">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </span>
      );
    case "saved":
      return (
        <span className={cn(base, "text-muted-foreground", className)} role="status">
          <Check className="size-3.5 text-accent" aria-hidden />
          Saved
        </span>
      );
    case "error":
      return (
        <span className={cn(base, "text-destructive", className)} role="alert">
          <CircleAlert className="size-3.5" aria-hidden />
          {status.message}
        </span>
      );
    default:
      return null;
  }
}
