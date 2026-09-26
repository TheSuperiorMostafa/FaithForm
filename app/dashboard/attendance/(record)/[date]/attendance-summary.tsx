import Link from "next/link";
import { AlertCircle, Check, Clock, Hash, Pencil, Send, Smartphone } from "lucide-react";

import { ServiceDayHeader } from "@/components/attendance/service-day-header";
import { buttonVariants } from "@/components/ui/button";
import { describeFollowUpFailure } from "@/lib/attendance/follow-up-errors";
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
    return { label: "Text sent", variant: "sent" as const };
  }
  // The raw reason stays in the database for staff; the page says it plainly.
  const failure = describeFollowUpFailure(entry.follow_up_error);
  if (failure) {
    return { label: failure, variant: "failed" as const };
  }
  if (!entry.member?.phone) {
    return { label: "Not sent: no phone number on file", variant: "failed" as const };
  }
  // Nowhere to store a delivery receipt, so "requested" is all we can honestly
  // claim — see `deliveryTrackingAvailable`.
  if (!trackingDelivery) {
    return { label: "Text requested", variant: "sent" as const };
  }
  return { label: "Sending", variant: "queued" as const };
}

export function AttendanceSummary({
  data,
  serviceDate,
  canFollowUp,
  checkedInElsewhere = [],
}: AttendanceSummaryProps) {
  const { record, entries, deliveryTrackingAvailable } = data;
  const countedByNumber = entries.length === 0;
  const elsewhere = new Set(checkedInElsewhere.map((item) => item.member.id));
  const present = entries.filter((e) => e.status === "present");
  const markedAbsent = entries.filter((e) => e.status === "absent");
  // Marked absent, but the app, a code or a room says they came.
  const absent = markedAbsent.filter((e) => !e.member || !elsewhere.has(e.member.id));
  const presentCount = countedByNumber
    ? Math.max(record.total_present ?? 0, checkedInElsewhere.length)
    : (record.total_present ?? present.length) + checkedInElsewhere.length;
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
  const stillToText = absent.filter((e) => !e.follow_up_requested && e.member?.phone).length;
  const offerFollowUp = canFollowUp && !countedByNumber && stillToText > 0;
  const dayLabel = formatServiceDate(serviceDate);

  const editLink = (
    <Link
      href={`/dashboard/attendance/${serviceDate}?edit=1`}
      className={buttonVariants({ variant: offerFollowUp ? "outline" : "default", size: offerFollowUp ? "default" : "lg" })}
    >
      <Pencil aria-hidden />
      Edit attendance
    </Link>
  );

  return (
    <div className="flex w-full flex-col gap-8">
      <ServiceDayHeader
        title={dayLabel}
        description={
          countedByNumber
            ? "Saved as one number for this Sunday."
            : "Attendance is saved for this Sunday."
        }
        secondary={offerFollowUp ? editLink : undefined}
        action={
          offerFollowUp ? (
            <Link
              href={`/dashboard/attendance/follow-up/${serviceDate}`}
              className={buttonVariants({ size: "lg" })}
            >
              <Send aria-hidden />
              Text people who missed
            </Link>
          ) : (
            editLink
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Here" value={presentCount} tone="good">
          {countedByNumber
            ? "Counted as one number"
            : checkedInElsewhere.length > 0
              ? `Including ${checkedInElsewhere.length} who checked in`
              : "Marked by name"}
        </StatCard>
        <StatCard label="Not here" value={countedByNumber ? null : absentCount} tone="bad">
          {countedByNumber ? "Not counted by name" : "Marked not here"}
        </StatCard>
        {canFollowUp ? (
          <StatCard label="Texts sent" value={countedByNumber ? null : followUpsSent.length} tone="accent">
            {countedByNumber
              ? "No names to text"
              : followUpsQueued.length > 0
                ? `${followUpsQueued.length} still sending`
                : followUps.length > 0
                  ? `To ${followUps.length} ${followUps.length === 1 ? "person" : "people"}`
                  : "None yet"}
          </StatCard>
        ) : (
          <StatCard label="How it was counted" value={null} tone="accent">
            {countedByNumber ? "One number" : "By name"}
          </StatCard>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          {countedByNumber ? (
            <section className="flex items-start gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
              >
                <Hash className="size-6" strokeWidth={1.75} />
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-lg font-semibold text-foreground">
                  Counted as one number
                </h2>
                <p className="text-[15px] text-muted-foreground">
                  There are no names for this Sunday, so there&apos;s nobody to
                  text. To follow up with who missed, choose Edit attendance and
                  count by name.
                </p>
              </div>
            </section>
          ) : null}

          {canFollowUp && followUps.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-xl font-bold text-foreground">Texts sent</h2>
              <ul className="flex flex-col gap-2">
                {followUps.map((entry) => {
                  const member = entry.member;
                  if (!member) return null;

                  const status = getFollowUpStatus(entry, deliveryTrackingAvailable);

                  return (
                    <li
                      key={entry.id}
                      className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                    >
                      <Avatar first={member.first_name} last={member.last_name} />
                      <div className="min-w-0 flex-1">
                        <span className="text-base font-medium text-foreground">
                          {member.first_name} {member.last_name}
                        </span>
                        <p
                          className={cn(
                            "text-sm",
                            status.variant === "sent" && "text-green-700 dark:text-green-300",
                            status.variant === "queued" && "text-amber-700 dark:text-amber-300",
                            status.variant === "failed" && "text-muted-foreground",
                          )}
                        >
                          {status.label}
                        </p>
                      </div>
                      {status.variant === "sent" ? (
                        <Check className="size-5 shrink-0 text-green-700 dark:text-green-300" strokeWidth={1.75} aria-hidden />
                      ) : status.variant === "queued" ? (
                        <Clock className="size-5 shrink-0 text-amber-700 dark:text-amber-300" strokeWidth={1.75} aria-hidden />
                      ) : (
                        <AlertCircle className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {checkedInElsewhere.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="font-heading text-xl font-bold text-foreground">Checked in</h2>
                <p className="text-[15px] text-muted-foreground">
                  Counted as here because they checked in, even though the list
                  didn&apos;t mark them here.
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {checkedInElsewhere.map(({ member, methods }) => (
                  <li
                    key={member.id}
                    className="flex min-h-16 items-center gap-3 rounded-2xl border border-green-200/80 bg-card px-4 py-3 dark:border-green-500/30"
                  >
                    <Avatar first={member.first_name} last={member.last_name} tone="good" />
                    <div className="min-w-0 flex-1">
                      <span className="text-base font-medium text-foreground">
                        {member.first_name} {member.last_name}
                      </span>
                      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Smartphone className="size-4 shrink-0" aria-hidden />
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
              <h2 className="font-heading text-xl font-bold text-foreground">Not here</h2>
              <ul className="flex flex-col gap-2">
                {absent.map((entry) => {
                  const member = entry.member;
                  if (!member) return null;

                  return (
                    <li
                      key={entry.id}
                      className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"
                    >
                      <Avatar first={member.first_name} last={member.last_name} tone="muted" />
                      <span className="min-w-0 flex-1 text-base font-medium text-foreground">
                        {member.first_name} {member.last_name}
                      </span>
                      {canFollowUp ? (
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {entry.follow_up_requested ? "Texted" : member.phone ? "Not texted yet" : "No phone number"}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : !countedByNumber ? (
            <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-base text-muted-foreground">
              Everyone on the list was here.
            </p>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card lg:sticky lg:top-6 dark:shadow-none">
          <h2 className="font-heading text-lg font-semibold text-foreground">Notes about this Sunday</h2>
          <p className="whitespace-pre-line text-[15px] text-muted-foreground">
            {record.notes?.trim() || "No notes were added."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: number | null;
  tone: "good" | "bad" | "accent";
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-36 flex-col gap-1 rounded-2xl border-2 border-border bg-card p-6 shadow-card dark:shadow-none">
      <p className="text-[15px] font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-heading text-4xl font-bold tabular-nums",
          value === null && "text-muted-foreground",
          value !== null && tone === "good" && "text-green-700 dark:text-green-300",
          value !== null && tone === "bad" && "text-red-700 dark:text-red-300",
          value !== null && tone === "accent" && "text-accent",
        )}
      >
        {value === null ? "—" : value}
      </p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function Avatar({
  first,
  last,
  tone = "accent",
}: {
  first: string;
  last: string;
  tone?: "accent" | "good" | "muted";
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-base font-bold",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "good" && "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {getInitials(first, last)}
    </div>
  );
}
