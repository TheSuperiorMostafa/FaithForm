import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getChurchTimezone,
  getRecentSundayRecords,
} from "@/lib/queries/attendance";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";
import { formatServiceDate, getLast8Sundays } from "@/lib/utils/dates";

export default async function AttendancePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const churchId = await getCurrentChurchId(supabase, user.id);

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

  const timezone = await getChurchTimezone(supabase, churchId);
  const sundays = getLast8Sundays(new Date(), timezone);
  const recordsByDate = await getRecentSundayRecords(
    supabase,
    churchId,
    sundays,
  );

  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold text-foreground">
          Weekly Attendance
        </h1>
        <p className="text-base text-muted-foreground">
          Select a service date to mark attendance or view a completed record.{" "}
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
          const status = recordsByDate.get(date);
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
