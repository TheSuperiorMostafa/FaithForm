"use client";

import { SectionError } from "@/components/dashboard/section-error";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SectionError
      error={error}
      reset={reset}
      what="Giving"
      description="Nothing you saved was lost. Try again in a moment. If it keeps happening, contact support from Help."
    />
  );
}
