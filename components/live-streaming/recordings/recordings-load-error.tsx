"use client";

import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/ui/error-state";

/** A failed load is never shown as "No recordings yet". */
export function RecordingsLoadError() {
  const router = useRouter();
  return (
    <ErrorState
      title="Your recordings didn't load"
      description="Nothing was lost. Try again, and if it keeps happening, contact FaithForm support."
      onRetry={() => router.refresh()}
    />
  );
}
