import { Monitor, RefreshCw, Smartphone, SquareArrowOutUpRight } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading pieces shared by the Website routes' `loading.tsx` files, so every
 * skeleton mirrors the real layout: same card shapes, same 620px preview
 * frame, and the static labels rendered as real text.
 */

/** Mirrors `SitePreview`: toolbar (real labels), 620px frame, caption. */
export function SitePreviewSkeleton({ sticky = false }: { sticky?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3", sticky && "lg:sticky lg:top-4")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-background px-4 text-sm font-semibold text-foreground shadow-sm">
            <Monitor className="size-4" aria-hidden /> Desktop
          </span>
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-4 text-sm font-semibold text-muted-foreground">
            <Smartphone className="size-4" aria-hidden /> Phone
          </span>
        </div>
        <div className="flex gap-1">
          <span className="inline-flex min-h-11 items-center gap-2 px-6 text-sm font-medium text-muted-foreground">
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </span>
          <span className="inline-flex min-h-11 items-center gap-2 px-6 text-sm font-medium text-muted-foreground">
            <SquareArrowOutUpRight className="size-4" aria-hidden /> Open in new tab
          </span>
        </div>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30" style={{ height: 620 }}>
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>
      <p className="text-sm text-muted-foreground">Your website exactly as a visitor sees it.</p>
    </div>
  );
}

/** Mirrors `LiveEditsNote`, whose wording depends on whether the site is live. */
export function LiveNoteSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 px-5 py-4">
      <Skeleton className="mt-0.5 size-5 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2 py-0.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/** A labelled input placeholder at the real input height. */
export function FieldSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-semibold">{label}</span>
      <Skeleton className="h-12 w-full rounded-[10px]" />
    </div>
  );
}

/** Mirrors the rounded-2xl p-6 panels used on Look & Details. */
export function PanelSkeleton({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-4">
        <h2 className="font-heading text-lg font-bold">{title}</h2>
        {description ? (
          <p className="text-[15px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
