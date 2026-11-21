"use client";

import Link from "next/link";
import { RotateCw } from "lucide-react";

import { JobProgress } from "@/components/sermon-media/job-progress";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { ClipRequestState, ClipRequestView } from "@/lib/sermon-media/clip-requests";
import { recordingPageHref } from "@/lib/sermon-media/hrefs";

const TONE: Record<ClipRequestState, StatusTone> = {
  transcribing: "working",
  finding: "working",
  failed: "attention",
  no_moments: "neutral",
};

/**
 * Make clips requests that haven't reached Ready to review yet: still being
 * written out, being searched for moments, or stopped with what to do next.
 */
export function ClipRequests({
  requests,
  retrying,
  onRetry,
}: {
  requests: ClipRequestView[];
  retrying: string | null;
  onRetry: (request: ClipRequestView) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="clip-requests-title" className="flex flex-col gap-3">
      <h2 id="clip-requests-title" className="text-lg font-semibold">
        Clips you asked for
      </h2>
      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        {requests.map((request) => (
          <li key={request.recordingId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-[15px] font-semibold">{request.title}</span>
                <StatusBadge tone={TONE[request.state]}>{request.label}</StatusBadge>
              </div>
              <p className="text-[15px] text-muted-foreground">{request.detail}</p>
              {request.progress && request.state === "transcribing" ? (
                <JobProgress progress={request.progress} compact className="mt-1 max-w-md" />
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {request.canRetry ? (
                <Button type="button" variant="outline" disabled={retrying === request.recordingId} onClick={() => onRetry(request)}>
                  <RotateCw aria-hidden />
                  {retrying === request.recordingId ? "Starting…" : "Try again"}
                </Button>
              ) : null}
              {request.state === "failed" || request.state === "no_moments" ? (
                <Link
                  href={recordingPageHref(request.recordingId)}
                  className="inline-flex min-h-11 items-center px-2 text-[15px] font-medium text-primary underline underline-offset-4 dark:text-accent"
                >
                  Open the recording
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
