"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatPhoneDisplay } from "@/lib/people/validate-member";
import type {
  FollowUpLogStatus,
  FollowUpLogSunday,
} from "@/lib/queries/follow-up-log";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<FollowUpLogStatus, string> = {
  sent: "Sent",
  failed: "Failed",
  skipped: "Not sent",
};

function formatSunday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: FollowUpLogStatus }) {
  if (status === "sent") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Check className="size-3" />
        {STATUS_LABEL.sent}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <AlertTriangle className="size-3" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FollowUpLog({ sundays }: { sundays: FollowUpLogSunday[] }) {
  // The most recent Sunday is the one being reviewed; older ones stay folded.
  const [openDates, setOpenDates] = useState<string[]>(
    sundays.length > 0 ? [sundays[0]!.serviceDate] : [],
  );

  if (sundays.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-base text-muted-foreground">
        No follow-up texts have been sent yet. Once you send check-ins from the
        Follow-up page, every message shows up here.
      </p>
    );
  }

  function toggle(date: string) {
    setOpenDates((prev) =>
      prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date],
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sundays.map((sunday) => {
        const open = openDates.includes(sunday.serviceDate);
        return (
          <section
            key={sunday.serviceDate}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
          >
            <button
              type="button"
              onClick={() => toggle(sunday.serviceDate)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-col gap-1">
                <span className="font-heading text-base font-semibold text-foreground">
                  {formatSunday(sunday.serviceDate)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {sunday.entries.length}{" "}
                  {sunday.entries.length === 1 ? "message" : "messages"}
                  {sunday.failedCount > 0 &&
                    ` · ${sunday.failedCount} needing attention`}
                </span>
              </div>
              <ChevronDown
                className={cn(
                  "size-5 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>

            {open && (
              <ul className="divide-y divide-border border-t border-border">
                {sunday.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-2 px-5 py-4 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-foreground">
                          {entry.recipientName}
                        </span>
                        <span className="text-muted-foreground">
                          {formatPhoneDisplay(entry.recipientPhone) ??
                            "No number on file"}
                        </span>
                      </div>
                      <StatusBadge status={entry.status} />
                    </div>

                    <p className="flex gap-2 rounded-xl bg-muted/50 px-3 py-2 leading-relaxed text-foreground">
                      <MessageSquare
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                      {entry.message}
                    </p>

                    {entry.error && (
                      <p className="text-xs text-destructive">{entry.error}</p>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Sent by {entry.senderName ?? "your church"}
                      {entry.senderPhone
                        ? ` from ${formatPhoneDisplay(entry.senderPhone) ?? entry.senderPhone}`
                        : ""}{" "}
                      · {formatTime(entry.sentAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
