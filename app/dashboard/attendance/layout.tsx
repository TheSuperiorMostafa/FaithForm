import { LiveAttendanceRefresh } from "@/components/attendance/live-attendance-refresh";
import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionLinkTabs } from "@/components/dashboard/section-link-tabs";
import { attendanceSectionTabs } from "@/lib/attendance/section-tabs";
import { getFeatureAccess } from "@/lib/features/access";

/**
 * Attendance holds the tools that different people run.
 *
 * Counting a Sunday is volunteer work; deciding who gets a check-in text is the
 * pastor's. They are granted separately (`attendance` / `attendance_follow_up`),
 * so this layout only checks that the member holds at least one of the two —
 * each tab's own layout gates its half. The tab strip (see
 * `lib/attendance/section-tabs.ts`) lists only what the member can open:
 * Attendance brings Sunday count, Services and Setup, and someone holding only
 * Follow-up sees no tabs at all. Kids Check-in has its own sidebar row.
 */
export default async function AttendanceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getFeatureAccess();
  const allowed = access?.allowed ?? [];

  const holdsAttendance =
    allowed.includes("attendance") || allowed.includes("attendance_follow_up");
  const tabs = attendanceSectionTabs(allowed);

  if (!holdsAttendance) {
    // Same shape as FeatureGate's locked state — a member who hits one of
    // these should not be able to tell which layer turned them away.
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center px-4 py-10 text-center sm:py-16">
        <div className="relative mb-6 flex items-center justify-center">
          <span
            aria-hidden
            className="absolute size-32 rounded-full bg-gradient-to-b from-accent/25 to-accent/0 blur-xl"
          />
          <span className="relative flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-card">
            <ShieldOff className="size-7 text-accent" strokeWidth={1.5} aria-hidden />
          </span>
        </div>
        <span className="mb-3 rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
          No access
        </span>
        <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-[28px]">
          You don&apos;t have access to Attendance
        </h2>
        <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          A church admin can grant you Attendance or Follow-up access from
          Settings → Team.
        </p>
        <div className="mt-7">
          <Link href="/dashboard">
            <Button>Back to dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <LiveAttendanceRefresh />
      {tabs.length > 1 && <SectionLinkTabs tabs={tabs} label="Attendance sections" />}
      {children}
    </div>
  );
}
