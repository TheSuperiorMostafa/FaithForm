"use client";

import { SectionError } from "@/components/dashboard/section-error";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <SectionError error={error} reset={reset} what="Settings" />;
}
