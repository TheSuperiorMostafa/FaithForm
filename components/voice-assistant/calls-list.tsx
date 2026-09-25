"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Phone, PhoneCall } from "lucide-react";

import type { CallListItem } from "@/app/dashboard/call-log/call-view";
import { CallBackButton, MarkHandledButton } from "@/components/voice-assistant/call-follow-up";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sortCallsForFollowUp } from "@/lib/utils/call-score";
import { formatCallTime } from "@/lib/utils/voice-assistant";
import { cn } from "@/lib/utils";

type View = "call-back" | "all";

/**
 * The church's phone log: who is waiting for a call back (urgent first), then
 * every call. Big rows rather than a table, so nothing scrolls sideways on a
 * phone.
 */
export function CallsList({
  calls,
  canMarkHandled,
}: {
  calls: CallListItem[];
  /** Church admin, and the database has the handled columns. */
  canMarkHandled: boolean;
}) {
  // Optimistic: a call marked handled leaves the call-back list at once.
  const [handledIds, setHandledIds] = useState<Record<string, boolean>>({});
  const resolved = calls.map((call) => {
    const override = handledIds[call.id];
    if (override === undefined || override === call.handled) return call;
    return override
      ? { ...call, handled: true, needsCallBack: false, urgent: false, statusLabel: "Handled", statusTone: "done" as const }
      : call;
  });

  const needing = sortCallsForFollowUp(resolved.filter((call) => call.needsCallBack));
  const all = resolved;

  const onHandledChange = (id: string) => (handled: boolean) =>
    setHandledIds((prev) => ({ ...prev, [id]: handled }));

  return (
    <Tabs defaultValue={"call-back" satisfies View}>
      <TabsList aria-label="Which calls to show">
        <TabsTrigger value="call-back">Needs a call back ({needing.length})</TabsTrigger>
        <TabsTrigger value="all">All calls ({all.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="call-back" className="mt-6">
        {needing.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="Nobody is waiting for a call back"
            description="When a caller needs someone from the church to ring them back, they'll show up here, with urgent calls first."
          />
        ) : (
          <CallRows calls={needing} canMarkHandled={canMarkHandled} onHandledChange={onHandledChange} />
        )}
      </TabsContent>

      <TabsContent value="all" className="mt-6">
        <CallRows calls={all} canMarkHandled={false} onHandledChange={onHandledChange} />
      </TabsContent>
    </Tabs>
  );
}

function CallRows({
  calls,
  canMarkHandled,
  onHandledChange,
}: {
  calls: CallListItem[];
  canMarkHandled: boolean;
  onHandledChange: (id: string) => (handled: boolean) => void;
}) {
  return (
    <ul
      aria-label="Calls"
      className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm"
    >
      {calls.map((call) => (
        <CallRow
          key={call.id}
          call={call}
          canMarkHandled={canMarkHandled}
          onHandledChange={onHandledChange(call.id)}
        />
      ))}
    </ul>
  );
}

function CallRow({
  call,
  canMarkHandled,
  onHandledChange,
}: {
  call: CallListItem;
  canMarkHandled: boolean;
  onHandledChange: (handled: boolean) => void;
}) {
  const Icon = call.urgent ? AlertTriangle : call.needsCallBack ? PhoneCall : Phone;
  const showMarkHandled = canMarkHandled && call.needsCallBack;

  return (
    <li className="flex flex-col gap-3 rounded-2xl sm:flex-row sm:items-center">
      <Link
        href={`/dashboard/call-log/${call.id}`}
        className="flex min-h-[80px] min-w-0 flex-1 items-start gap-4 rounded-2xl px-4 py-4 transition-colors hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-full",
            call.urgent
              ? "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
              : "bg-primary/[0.08] text-primary dark:bg-accent/15 dark:text-accent",
          )}
        >
          <Icon className="size-6" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-base font-semibold text-foreground">{call.callerLabel}</span>
            <span className="text-[15px] text-muted-foreground" suppressHydrationWarning>
              {formatCallTime(call.calledAt)}
            </span>
          </span>
          <span className="line-clamp-2 block text-[15px] leading-relaxed text-muted-foreground">
            {call.summary ?? "No summary for this call yet. Open it to listen or read the transcript."}
          </span>
          <span className="block pt-1">
            <StatusBadge tone={call.statusTone}>{call.statusLabel}</StatusBadge>
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-3 hidden size-5 shrink-0 text-muted-foreground sm:block" />
      </Link>
      {(call.dial || showMarkHandled) && (
        <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-3 sm:pb-0">
          {call.dial && (
            <CallBackButton dial={call.dial} callerLabel={call.callerLabel} primary={call.urgent} />
          )}
          {showMarkHandled && (
            <MarkHandledButton
              callId={call.id}
              callerLabel={call.callerLabel}
              handled={call.handled}
              onChange={onHandledChange}
            />
          )}
        </div>
      )}
    </li>
  );
}
