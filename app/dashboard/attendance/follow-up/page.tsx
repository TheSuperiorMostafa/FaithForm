import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarDays, ChevronRight, Hash } from "lucide-react";

import { LogLink } from "./log-link";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { getChurchAuth } from "@/lib/auth/church";
import { listRecordedServices } from "@/lib/queries/attendance";
import { createClient } from "@/lib/supabase/server";
import { formatServiceDate, isValidDateParam } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ date?: string }>;
};

/** Counted Sundays, newest first, laid out like Sunday count. Green once texts went out. */
export default async function AttendanceFollowUpPage({ searchParams }: PageProps) {
  const query = await searchParams;
  // Older links pointed at ?date=; each Sunday has its own page now.
  if (query.date && isValidDateParam(query.date)) {
    redirect(`/dashboard/attendance/follow-up/${query.date}`);
  }

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) redirect("/login");

  const services = await listRecordedServices(supabase, auth.churchId, 12);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={ATTENDANCE_COPY.followUp.title}
        description={ATTENDANCE_COPY.followUp.description}
        secondary={<LogLink />}
      />

      {services.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No Sundays counted yet"
          description="Once a Sunday is counted by name, the people who missed it show up here."
        />
      ) : (
        <section className="flex min-w-0 flex-col gap-3" aria-label="Counted Sundays">
          {services.map((service, index) => {
            const done = service.followedUp > 0;
            const isLatest = index === 0;
            return (
              <Link
                key={service.serviceDate}
                href={`/dashboard/attendance/follow-up/${service.serviceDate}`}
                className={cn(
                  "group flex min-h-24 items-center gap-4 rounded-2xl border px-5 py-4 shadow-card transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-none",
                  "border-border bg-card hover:border-accent/40 hover:bg-accent/5",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "hidden size-12 shrink-0 items-center justify-center rounded-xl sm:flex",
                    done
                      ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <CalendarDays className="size-6" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-heading text-lg font-semibold text-foreground">
                      {formatServiceDate(service.serviceDate, { isLatest })}
                    </span>
                    {isLatest ? (
                      <span className="text-[15px] text-muted-foreground">
                        {formatServiceDate(service.serviceDate)}
                      </span>
                    ) : null}
                  </span>
                  {!service.byName ? (
                    <span className="flex items-center gap-1.5 text-base text-muted-foreground">
                      <Hash className="size-4 shrink-0" aria-hidden />
                      Counted as a number. No names to follow up with.
                    </span>
                  ) : done ? (
                    <span className="text-base font-medium text-green-700 dark:text-green-300">
                      {service.followedUp === 1 ? "1 person" : `${service.followedUp} people`} texted
                    </span>
                  ) : (
                    <span className="text-base text-muted-foreground">
                      {service.totalAbsent === 1 ? "1 person" : `${service.totalAbsent} people`} not here
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {done ? <StatusBadge tone="done">Followed up</StatusBadge> : null}
                  <ChevronRight
                    aria-hidden
                    className="hidden size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none sm:block"
                  />
                </span>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
