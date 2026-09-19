import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";
import { getChurchAuth } from "@/lib/auth/church";
import { getPresenceByDate } from "@/lib/attendance/presence";
import { getRecentSundayRecords } from "@/lib/queries/attendance";
import { createClient } from "@/lib/supabase/server";
import { formatServiceDate, getLast8Sundays } from "@/lib/utils/dates";

export default async function AttendancePage() {
  const supabase = createClient();
  const auth = await getChurchAuth();

  if (!auth) {
    redirect("/login");
  }

  const churchId = auth.churchId;

  if (!churchId) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          No church linked yet
        </h2>
        <p className="max-w-md text-base text-muted-foreground">
          Your account is not linked to a church yet. Contact support to connect
          your church before tracking attendance.
        </p>
      </div>
    );
  }

  const sundays = getLast8Sundays(new Date(), auth.churchTimezone);
  const [recordsByDate, presenceByDate] = await Promise.all([
    getRecentSundayRecords(supabase, churchId, sundays),
    // Everyone recorded any way — the sheet, the app, a code, the kiosk, a
    // room — counted once. Null on a database without migration 0083, where
    // the sheet's own numbers are all there is.
    sundays.length > 0
      ? getPresenceByDate(supabase, churchId, sundays[sundays.length - 1], sundays[0])
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Weekly Attendance
        </h1>
        <p className="text-base text-muted-foreground">
          Select a service date to mark attendance or view a completed record.
          Anyone checked in by the app, a code, the kiosk or a room is already
          counted.{" "}
          <Link
            href="/dashboard/people"
            className="font-semibold text-accent hover:underline"
          >
            Manage people &amp; phones
          </Link>
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {sundays.map((date, index) => {
          const sheet = recordsByDate.get(date);
          const day = presenceByDate?.get(date);
          const status = sheet
            ? {
                ...sheet,
                totalPresent: day?.present ?? sheet.totalPresent,
                totalAbsent: day?.absent ?? sheet.totalAbsent,
              }
            : undefined;
          const checkedIn = !sheet ? (day?.checkedIn ?? 0) : 0;
          const isLatest = index === 0;
          const label = formatServiceDate(date, { isLatest });

          return (
            <Link
              key={date}
              href={`/dashboard/attendance/${date}`}
              className={cn(
                "flex min-h-20 flex-col justify-center gap-2 rounded-xl border px-5 py-4 shadow-card transition-all dark:shadow-none",
                isLatest
                  ? "border-accent/50 bg-accent/10 hover:bg-accent/15"
                  : "border-border bg-card hover:border-accent/40 hover:bg-accent/5",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-heading text-lg font-semibold text-foreground">
                  {label}
                </span>
                {status ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-300">
                    <Check className="size-4" strokeWidth={1.75} aria-hidden />
                    Completed
                  </span>
                ) : checkedIn > 0 ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-navy/10 px-3 py-1 text-sm font-semibold text-primary dark:bg-brand-gold/15 dark:text-accent">
                    <Smartphone className="size-4" strokeWidth={1.75} aria-hidden />
                    {checkedIn} checked in
                  </span>
                ) : (
                  <span className="inline-flex shrink-0 rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
                    Not started
                  </span>
                )}
              </div>

              {status ? (
                <p className="text-base font-medium text-green-700 dark:text-green-300">
                  {status.totalPresent} present
                  {status.totalAbsent > 0
                    ? `, ${status.totalAbsent} absent`
                    : ""}
                  {status.followedUp > 0
                    ? `, ${status.followedUp} followed up`
                    : ""}
                </p>
              ) : checkedIn > 0 ? (
                <p className="text-base text-muted-foreground">
                  {checkedIn === 1 ? "1 person is" : `${checkedIn} people are`}{" "}
                  already counted from check-ins. Tap to mark everyone else.
                </p>
              ) : (
                <p className="text-base text-muted-foreground">
                  Tap to mark attendance for this Sunday
                </p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
