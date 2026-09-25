"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/error-state";

/**
 * Shared body for every dashboard `error.tsx`. Plain words, a retry, a way
 * home. The technical error goes to the console for engineers.
 */
export function SectionError({
  error,
  reset,
  what = "this page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  what?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title={`We couldn't load ${what}`}
      description="Nothing you saved was lost. Try again in a moment. If it keeps happening, contact FaithForm support from Help."
      onRetry={reset}
      homeHref="/dashboard"
    />
  );
}
