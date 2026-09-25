import { CalendarClock, ChevronDown, Smartphone } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";

const STEPS = ["Your service times", "When check-in is open", "Ways to check in at church"];

/**
 * Setup, loading. Mirrors `setup/page.tsx` and `CheckinSetup`: three steps
 * with their real titles, the optional phone check-in card, and Coming up.
 * What each step says about this church shimmers.
 */
export default function CheckinSetupLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="attendance setup">
      <PageHeader title={ATTENDANCE_COPY.setup.title} description={ATTENDANCE_COPY.setup.description} />

      <div className="flex w-full flex-col gap-6">
        {STEPS.map((title, index) => (
          <div key={title} className="rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
            <div className="flex min-h-16 items-center gap-4 p-5 sm:p-6">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="font-heading text-lg font-semibold text-foreground">{title}</span>
                <Skeleton className="h-5 w-72 max-w-full" />
              </span>
              <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            </div>
          </div>
        ))}

        <div className="rounded-2xl border border-border bg-card shadow-card dark:shadow-none">
          <div className="flex items-start gap-4 p-5 sm:p-6">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Smartphone className="size-6" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-heading text-lg font-semibold text-foreground">
                Let people check in on their phone when they arrive
                <span className="ml-2 text-sm font-medium text-muted-foreground">Optional</span>
              </p>
              <p className="text-[15px] leading-relaxed text-muted-foreground">
                People who turn it on in the FaithForm app are counted when their
                phone arrives at church during check-in. Their phone sends one
                reading on arrival, which is checked and thrown away: you see that
                they came, never where they were.
              </p>
            </div>
            <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 dark:shadow-none">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <CalendarClock className="size-6" strokeWidth={1.75} aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-heading text-lg font-semibold text-foreground">Coming up</p>
              <p className="text-[15px] text-muted-foreground">
                Your next services and when check-in is open. Who came shows on
                Services and counts toward the Sunday count.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col divide-y divide-border">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex min-h-16 flex-col justify-center gap-2 py-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
