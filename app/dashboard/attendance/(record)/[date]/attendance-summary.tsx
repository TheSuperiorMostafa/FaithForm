import Link from "next/link";
import { ArrowLeft, Check, Clock, AlertCircle, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describePresence,
  type PresenceMethod,
} from "@/lib/attendance/presence";
import type {
  AttendanceEntryWithMember,
  AttendanceMember,
  AttendanceRecordWithEntries,
} from "@/lib/queries/attendance";
import { formatServiceDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

/** Present this day some way other than being marked present on the sheet. */
export type CheckedInElsewhere = {
  member: Pick<AttendanceMember, "id" | "first_name" | "last_name">;
  methods: PresenceMethod[];
};

type AttendanceSummaryProps = {
  data: AttendanceRecordWithEntries;
  serviceDate: string;
  /** Only Follow-up holders get the link across to choose who gets a text. */
  canFollowUp: boolean;
  /**
   * Checked in by the app, a code, the kiosk, the Services roster or a room,
   * and not marked present on the sheet — some were even marked absent. They
   * came, so they count as present and are not listed as absent.
   */
  checkedInElsewhere?: CheckedInElsewhere[];
};

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function getFollowUpStatus(
  entry: AttendanceEntryWithMember,
  trackingDelivery: boolean,
) {
  if (entry.follow_up_sent_at) {
    return { label: "Sent", variant: "sent" as const };
  }
  if (entry.follow_up_error) {
    return { label: entry.follow_up_error, variant: "failed" as const };
  }
  if (!entry.member?.phone) {
    return { label: "No phone on file", variant: "failed" as const };
  }
  // Nowhere to store a delivery receipt, so "requested" is all we can honestly
  // claim — see `deliveryTrackingAvailable`.
  if (!trackingDelivery) {
    return { label: "Requested", variant: "sent" as const };
  }
  return { label: "Queued", variant: "queued" as const };
}

export function AttendanceSummary({
  data,
  serviceDate,
  canFollowUp,
  checkedInElsewhere = [],
}: AttendanceSummaryProps) {
  const { record, entries, deliveryTrackingAvailable } = data;
  const elsewhere = new Set(checkedInElsewhere.map((item) => item.member.id));
  const present = entries.filter((e) => e.status === "present");
  const markedAbsent = entries.filter((e) => e.status === "absent");
  // Marked absent, but the app, a code or a room says they came.
  const absent = markedAbsent.filter((e) => !e.member || !elsewhere.has(e.member.id));
  const presentCount =
    (record.total_present ?? present.length) + checkedInElsewhere.length;
  const absentCount = Math.max(
    (record.total_absent ?? markedAbsent.length) - (markedAbsent.length - absent.length),
    0,
  );
  // A text already sent stays on the record even if they turned out to be here.
  const followUps = markedAbsent.filter((e) => e.follow_up_requested);
  const followUpsSent = followUps.filter((e) => e.follow_up_sent_at);
  const followUpsQueued = followUps.filter(
    (e) => !e.follow_up_sent_at && !e.follow_up_error,
  );

  return (
    <div className="flex w-full flex-col gap-5">
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
            {presentCount}
          </p>
          {checkedInElsewhere.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              including {checkedInElsewhere.length} checked in
            </p>
          ) : null}
        </div>
        <div className="rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none">
          <p className="text-sm text-muted-foreground">Absent</p>
          <p className="mt-1 font-heading text-4xl font-bold text-red-700 dark:text-red-300">
            {absentCount}
          </p>
        </div>
        {canFollowUp ? (
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
        ) : null}
      </div>

      {record.notes ? (
        <section className="rounded-xl border border-border bg-card p-5 shadow-card dark:shadow-none">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Service notes
          </h2>
          <p className="mt-2 text-base text-muted-foreground">{record.notes}</p>
        </section>
      ) : null}

      {canFollowUp && followUps.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Follow-up texts
          </h2>
          <ul className="flex flex-col gap-2">
            {followUps.map((entry) => {
              const member = entry.member;
              if (!member) return null;

              const status = getFollowUpStatus(
                entry,
                deliveryTrackingAvailable,
              );

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

      {checkedInElsewhere.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              Checked in
            </h2>
            <p className="text-sm text-muted-foreground">
              Counted as present from a check-in, though the sheet did not mark
              them present.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {checkedInElsewhere.map(({ member, methods }) => (
              <li
                key={member.id}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-green-200/80 bg-card px-4 py-2 dark:border-green-500/30"
              >
                <div
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-base font-bold text-green-700 dark:bg-green-500/15 dark:text-green-300"
                  aria-hidden
                >
                  {getInitials(member.first_name, member.last_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-base font-medium text-foreground">
                    {member.first_name} {member.last_name}
                  </span>
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Smartphone className="size-3.5 shrink-0" aria-hidden />
                    {describePresence(methods)}
                  </p>
                </div>
              </li>
            ))}
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
                    canFollowUp &&
                      !entry.follow_up_requested &&
                      "opacity-70",
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
                  {canFollowUp && !entry.follow_up_requested ? (
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

      <div className="flex flex-col gap-3 sm:flex-row">
        {canFollowUp ? (
          <Button
            render={<Link href={`/dashboard/attendance/follow-up?date=${serviceDate}`} />}
            nativeButton={false}
            size="lg"
            className="h-14 flex-1 text-base"
          >
            Choose follow-ups
          </Button>
        ) : null}
        <Button
          render={<Link href="/dashboard/attendance" />}
          nativeButton={false}
          size="lg"
          variant={canFollowUp ? "outline" : "default"}
          className="h-14 flex-1 text-base"
        >
          Back to Sundays
        </Button>
      </div>
    </div>
  );
}
