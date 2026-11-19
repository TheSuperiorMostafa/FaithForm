"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Donor-facing error boundary. Without it a giving page error falls through to
 * the app-wide boundary, which names the product; donors only see the church.
 */
export default function GiveError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[give] page error", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="space-y-4 rounded-2xl border border-border p-6 text-center">
      <h1 className="font-heading text-xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        This page couldn&apos;t load. Please try again. If it keeps happening, contact the church directly.
      </p>
      <Button type="button" className="min-h-11" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
