"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare, MessagesSquare } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { describeFollowUpFailure } from "@/lib/attendance/follow-up-errors";
import { formatPhoneDisplay } from "@/lib/people/validate-member";
import type {
  FollowUpLogStatus,
  FollowUpLogSunday,
} from "@/lib/queries/follow-up-log";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<FollowUpLogStatus, string> = {
  sent: "Sent",
  failed: "Not delivered",
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

function LogStatus({ status }: { status: FollowUpLogStatus }) {
  return (
    <StatusBadge tone={status === "sent" ? "done" : "attention"}>{STATUS_LABEL[status]}</StatusBadge>
  );
}

export function FollowUpLog({ sundays }: { sundays: FollowUpLogSunday[] }) {
  // The most recent Sunday is the one being reviewed; older ones stay folded.
  const [openDates, setOpenDates] = useState<string[]>(
    sundays.length > 0 ? [sundays[0]!.serviceDate] : [],
  );

  if (sundays.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No texts sent yet"
        description="When you text people from the Follow-up page, every message shows up here."
      />
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
              className="flex min-h-16 w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="flex flex-col gap-1">
                <span className="font-heading text-base font-semibold text-foreground">
                  {formatSunday(sunday.serviceDate)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {sunday.entries.length}{" "}
                  {sunday.entries.length === 1 ? "message" : "messages"}
                  {sunday.failedCount > 0 &&
                    ` · ${sunday.failedCount} not delivered`}
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
                    className="flex flex-col gap-2 px-5 py-4 text-[15px]"
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
                      <LogStatus status={entry.status} />
                    </div>

                    {entry.message && entry.message !== "(not sent)" ? (
                      <p className="flex gap-2 rounded-xl bg-muted/50 px-3 py-2 leading-relaxed text-foreground">
                        <MessageSquare
                          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {entry.message}
                      </p>
                    ) : null}

                    {/* The raw reason stays in the database for staff. */}
                    {entry.status !== "sent" && describeFollowUpFailure(entry.error) ? (
                      <p className="text-sm font-medium text-destructive">
                        {describeFollowUpFailure(entry.error)}
                      </p>
                    ) : null}

                    <p className="text-sm text-muted-foreground">
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
