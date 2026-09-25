"use client";

import { useRouter } from "next/navigation";

import { ErrorState } from "@/components/ui/error-state";

/** A failed page load with a working "Try again", for server-rendered pages. */
export function RetryErrorState({ title, description }: { title: string; description?: string }) {
  const router = useRouter();
  return <ErrorState title={title} description={description} onRetry={() => router.refresh()} />;
}
