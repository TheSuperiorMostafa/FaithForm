import Link from "next/link";
import { ArrowLeft, Check, Clock, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AttendanceEntryWithMember } from "@/lib/queries/attendance";
import type { AttendanceRecordWithEntries } from "@/lib/queries/attendance";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type AttendanceSummaryProps = {
  data: AttendanceRecordWithEntries;
  serviceDate: string;
};

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function getFollowUpStatus(entry: AttendanceEntryWithMember) {
  if (entry.follow_up_sent_at) {
    return { label: "Sent", variant: "sent" as const };
  }
  if (entry.follow_up_error) {
    return { label: entry.follow_up_error, variant: "failed" as const };
  }
  if (!entry.member?.phone) {
    return { label: "No phone on file", variant: "failed" as const };
  }
  return { label: "Queued", variant: "queued" as const };
}

export function AttendanceSummary({
  data,
  serviceDate,
}: AttendanceSummaryProps) {
  const { record, entries } = data;
  const present = entries.filter((e) => e.status === "present");
  const absent = entries.filter((e) => e.status === "absent");
  const followUps = absent.filter((e) => e.follow_up_requested);
  const followUpsSent = followUps.filter((e) => e.follow_up_sent_at);
  const followUpsQueued = followUps.filter(
    (e) => !e.follow_up_sent_at && !e.follow_up_error,
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/attendance"
          className="inline-flex items-center gap-2 text-base font-semibold text-muted-foreground hover:text-accent"
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Sundays
        </Link>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          {formatServiceDate(serviceDate)}
        </h1>
        <p className="text-base text-muted-foreground">
          Attendance already recorded for this service.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none">
          <p className="text-sm text-muted-foreground">Present</p>
          <p className="mt-1 font-heading text-4xl font-bold text-green-700 dark:text-green-300">
            {record.total_present ?? present.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none">
          <p className="text-sm text-muted-foreground">Absent</p>
          <p className="mt-1 font-heading text-4xl font-bold text-red-700 dark:text-red-300">
            {record.total_absent ?? absent.length}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none sm:col-span-1">
          <p className="text-sm text-muted-foreground">Follow-ups</p>
          <p className="mt-1 font-heading text-4xl font-bold text-accent">
            {followUps.length}
          </p>
          {followUps.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {followUpsSent.length} sent
              {followUpsQueued.length > 0
                ? ` · ${followUpsQueued.length} queued`
                : ""}
            </p>
          ) : null}
        </div>
      </div>

      {record.notes ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Service notes
          </h2>
          <p className="mt-2 text-base text-muted-foreground">{record.notes}</p>
        </section>
      ) : null}

      {followUps.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Follow-up texts
          </h2>
          <ul className="flex flex-col gap-2">
            {followUps.map((entry) => {
              const member = entry.member;
              if (!member) return null;

              const status = getFollowUpStatus(entry);

              return (
                <li
                  key={entry.id}
                  className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4"
                >
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-base font-bold text-accent"
                    aria-hidden
                  >
                    {getInitials(member.first_name, member.last_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-base font-medium text-foreground">
                      {member.first_name} {member.last_name}
                    </span>
                    <p
                      className={cn(
                        "text-sm",
                        status.variant === "sent" &&
                          "text-green-700 dark:text-green-300",
                        status.variant === "queued" &&
                          "text-amber-700 dark:text-amber-300",
                        status.variant === "failed" &&
                          "text-muted-foreground",
                      )}
                    >
                      {status.label}
                    </p>
                  </div>
                  {status.variant === "sent" ? (
                    <Check
                      className="size-5 shrink-0 text-green-700 dark:text-green-300"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : status.variant === "queued" ? (
                    <Clock
                      className="size-5 shrink-0 text-amber-700 dark:text-amber-300"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : (
                    <AlertCircle
                      className="size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {absent.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-foreground">Absent</h2>
          <ul className="flex flex-col gap-2">
            {absent.map((entry) => {
              const member = entry.member;
              if (!member) return null;

              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded-xl border border-border bg-card px-4",
                    !entry.follow_up_requested && "opacity-70",
                  )}
                >
                  <div
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground"
                    aria-hidden
                  >
                    {getInitials(member.first_name, member.last_name)}
                  </div>
                  <span className="text-base font-medium text-foreground">
                    {member.first_name} {member.last_name}
                  </span>
                  {!entry.follow_up_requested ? (
                    <span className="ml-auto text-sm text-muted-foreground">
                      No follow-up
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Button
        render={<Link href="/dashboard/attendance" />}
        nativeButton={false}
        size="lg"
        className="h-14 w-full text-base"
      >
        Back to Sundays
      </Button>
    </div>
  );
}
