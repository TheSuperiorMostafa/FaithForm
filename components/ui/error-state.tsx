"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A failed load or failed step, said plainly: what happened, whether anything
 * was lost, and what to do next. Never shows raw error text.
 */
export function ErrorState({
  title = "This didn't load",
  description = "Nothing you saved was lost. Try again, and if it keeps happening, contact FaithForm support.",
  onRetry,
  refreshOnRetry = false,
  retryLabel = "Try again",
  homeHref,
  className,
  compact = false,
}: {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  /** From a server page (which can't pass a function): retry by reloading its data. */
  refreshOnRetry?: boolean;
  retryLabel?: string;
  homeHref?: string;
  className?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const retry = onRetry ?? (refreshOnRetry ? () => router.refresh() : undefined);
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-4 text-center",
        compact
          ? "rounded-2xl border border-destructive/25 bg-destructive/[0.04] px-6 py-8"
          : "rounded-3xl border border-destructive/25 bg-card px-6 py-16",
        className,
      )}
    >
      <span
        aria-hidden
        className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
      >
        <AlertCircle className="size-7" strokeWidth={1.75} />
      </span>
      <div className="max-w-md space-y-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">{title}</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {retry && (
          <Button onClick={retry}>
            <RotateCcw aria-hidden />
            {retryLabel}
          </Button>
        )}
        {homeHref && (
          <Link href={homeHref} className={buttonVariants({ variant: "outline" })}>
            Go to Home
          </Link>
        )}
      </div>
    </div>
  );
}
