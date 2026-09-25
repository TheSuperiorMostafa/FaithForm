import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, FileText, Hash, Smartphone } from "lucide-react";

import { SundayDatePicker } from "@/components/attendance/sunday-date-picker";
import { SundayDraftBadge } from "@/components/attendance/sunday-draft-badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { getChurchAuth } from "@/lib/auth/church";
import { getPresenceByDate } from "@/lib/attendance/presence";
import { MAX_SUNDAYS, SUNDAYS_PER_PAGE, parseWeeksParam, recentSundays } from "@/lib/attendance/sundays";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { getFeatureAccess } from "@/lib/features/access";
import { getRecentSundayRecords } from "@/lib/queries/attendance";
import { createClient } from "@/lib/supabase/server";
import { formatServiceDate, toYMD } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

type PageProps = {
  searchParams: Promise<{ weeks?: string | string[] }>;
};

export default async function AttendancePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const supabase = createClient();
  const auth = await getChurchAuth();

  if (!auth) {
    redirect("/login");
  }

  const churchId = auth.churchId;

  if (!churchId) {
    return (
      <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
        <h2 className="text-xl font-semibold text-foreground">
          Your account isn&apos;t connected to a church yet
        </h2>
        <p className="max-w-md text-base text-muted-foreground">
          Contact FaithForm support to connect your church before counting attendance.
        </p>
      </div>
    );
  }

  const weeks = parseWeeksParam(query.weeks);
  const now = new Date();
  const today = toYMD(now, auth.churchTimezone);
  const sundays = recentSundays(now, auth.churchTimezone, weeks);
  const [recordsByDate, presenceByDate, access] = await Promise.all([
    getRecentSundayRecords(supabase, churchId, sundays),
    // Everyone recorded any way — the sheet, the app, a code, the kiosk, a
    // room — counted once. Null on a database without migration 0083, where
    // the sheet's own numbers are all there is.
    sundays.length > 0
      ? getPresenceByDate(supabase, churchId, sundays[sundays.length - 1], sundays[0])
      : Promise.resolve(null),
    getFeatureAccess(supabase),
  ]);

  const canSeeReports = access?.allowed.includes("library") ?? false;
  const latest = sundays[0];
  const latestDone = latest ? recordsByDate.has(latest) : true;

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={ATTENDANCE_COPY.sundayCount.title}
        description={ATTENDANCE_COPY.sundayCount.description}
        secondary={
          canSeeReports ? (
            <Link href="/dashboard/library" className={buttonVariants({ variant: "outline" })}>
              <FileText aria-hidden />
              Monthly reports
            </Link>
          ) : undefined
        }
        action={
          latest && !latestDone ? (
            <Link href={`/dashboard/attendance/${latest}`} className={buttonVariants({ size: "lg" })}>
              Count this Sunday
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <section className="flex min-w-0 flex-col gap-3" aria-label="Recent Sundays">
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
                  "group flex min-h-24 items-center gap-4 rounded-2xl border px-5 py-4 shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none",
                  isLatest && !status
                    ? "border-accent/50 bg-accent/10 hover:bg-accent/15"
                    : "border-border bg-card hover:border-accent/40 hover:bg-accent/5",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "hidden size-12 shrink-0 items-center justify-center rounded-xl sm:flex",
                    status ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-6" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-heading text-lg font-semibold text-foreground">{label}</span>
                    {isLatest ? (
                      <span className="text-[15px] text-muted-foreground">{formatServiceDate(date)}</span>
                    ) : null}
                  </span>
                  {status ? (
                    <span className="flex items-center gap-1.5 text-base font-medium text-green-700 dark:text-green-300">
                      {!status.byName ? <Hash className="size-4 shrink-0" aria-hidden /> : null}
                      {status.totalPresent} here
                      {status.byName && status.totalAbsent > 0 ? `, ${status.totalAbsent} not here` : ""}
                      {status.followedUp > 0 ? `, ${status.followedUp} texted` : ""}
                    </span>
                  ) : checkedIn > 0 ? (
                    <span className="flex items-center gap-1.5 text-base text-muted-foreground">
                      <Smartphone className="size-4 shrink-0" aria-hidden />
                      {checkedIn === 1 ? "1 person" : `${checkedIn} people`} already checked in. Tap to count everyone else.
                    </span>
                  ) : (
                    <span className="text-base text-muted-foreground">Tap to count who came</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {status ? (
                    <StatusBadge tone="done">Saved</StatusBadge>
                  ) : (
                    <SundayDraftBadge
                      serviceDate={date}
                      fallback={<StatusBadge tone="neutral">Not started</StatusBadge>}
                    />
                  )}
                  <ChevronRight
                    aria-hidden
                    className="hidden size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none sm:block"
                  />
                </span>
              </Link>
            );
          })}

          {weeks < MAX_SUNDAYS ? (
            <Link
              href={`/dashboard/attendance?weeks=${weeks + SUNDAYS_PER_PAGE}`}
              scroll={false}
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-1 w-full")}
            >
              <ChevronDown aria-hidden />
              Show earlier Sundays
            </Link>
          ) : null}
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <SundayDatePicker today={today} />
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <h2 className="font-heading text-base font-semibold text-foreground">A weekday service?</h2>
            <p className="text-[15px] text-muted-foreground">
              Bible study, prayer night and other services are counted on{" "}
              <Link
                href="/dashboard/attendance/services"
                className="font-semibold text-accent underline-offset-4 hover:underline"
              >
                Services
              </Link>
              .
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
