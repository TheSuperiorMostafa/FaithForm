import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";
import { getFeatureAccess } from "@/lib/features/access";

/**
 * Attendance holds two tools that different people run.
 *
 * Marking a service is volunteer work; deciding who gets a check-in text is the
 * pastor's. They are granted separately (`attendance` / `attendance_follow_up`),
 * so this layout only checks that the member holds at least one of them — each
 * tab's own layout gates its half. The tab strip lists only what they can open,
 * which means someone with a single grant sees no tabs at all.
 */
const TAB_FOR_FEATURE = {
  attendance: {
    label: "Attendance",
    href: "/dashboard/attendance",
    match: "exact",
  },
  attendance_follow_up: {
    label: "Follow-up",
    href: "/dashboard/attendance/follow-up",
    match: "prefix",
  },
} satisfies Record<"attendance" | "attendance_follow_up", SectionLinkTab>;

export default async function AttendanceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getFeatureAccess();

  const tabs = (["attendance", "attendance_follow_up"] as const)
    .filter((key) => access?.allowed.includes(key))
    .map((key) => TAB_FOR_FEATURE[key]);

  if (tabs.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center shadow-card">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldOff className="size-7" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="font-heading text-xl font-bold text-foreground">
            You don&apos;t have access to Attendance
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A church admin can grant you Attendance or Follow-up access from
            Settings → Team.
          </p>
        </div>
        <Link href="/dashboard">
          <Button variant="outline">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      {tabs.length > 1 && <SectionLinkTabs tabs={tabs} />}
      {children}
    </div>
  );
}
