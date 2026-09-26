"use client";

import Link from "next/link";
import { ChevronRight, Phone } from "lucide-react";

import type { CallListItem } from "@/app/dashboard/call-log/call-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCallTime } from "@/lib/utils/voice-assistant";

/**
 * The church's phone log: every call, newest first. Compact rows rather than
 * a table, so nothing scrolls sideways on a phone. Following up on a call
 * (calling back, marking it handled) happens on the call's own page.
 */
export function CallsList({ calls }: { calls: CallListItem[] }) {
  return (
    <ul
      aria-label="Calls"
      className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
    >
      {calls.map((call) => (
        <CallRow key={call.id} call={call} />
      ))}
    </ul>
  );
}

function CallRow({ call }: { call: CallListItem }) {
  return (
    <li>
      <Link
        href={`/dashboard/call-log/${call.id}`}
        className="flex min-h-11 min-w-0 items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Phone className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-base font-semibold text-foreground">{call.callerLabel}</span>
            <span className="text-[15px] text-muted-foreground" suppressHydrationWarning>
              {formatCallTime(call.calledAt)}
            </span>
            {call.callerNumber && (
              <span className="text-[15px] tabular-nums text-muted-foreground">{call.callerNumber}</span>
            )}
            {!call.needsCallBack && (
              <StatusBadge tone={call.statusTone}>{call.statusLabel}</StatusBadge>
            )}
          </span>
          <span className="line-clamp-2 block text-[15px] leading-snug text-muted-foreground">
            {call.summary ?? "No summary for this call yet. Open it to listen or read the transcript."}
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-2 hidden size-5 shrink-0 text-muted-foreground sm:block" />
      </Link>
    </li>
  );
}
