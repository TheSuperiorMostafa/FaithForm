import type { SectionLinkTab } from "@/components/dashboard/section-link-tabs";
import type { FeatureKey } from "@/lib/features/catalog";

/**
 * Attendance is one section with one set of tabs, wherever in it you are.
 *
 * Check-ins are attendance: the weekly sheet, the Services roster, children's
 * room check-in and the app's automatic check-in all answer "who came", and
 * they used to live under two sidebar entries — "Attendance" and "Check-In" —
 * with a "Check-in setup" tab under the first that had nothing to do with the
 * second. Now the section is one entry, and each tab is still granted by its
 * own feature: marking a service is volunteer work (`attendance`), who gets a
 * follow-up text is the pastor's (`attendance_follow_up`), and the room desk is
 * its own grant (`checkin`). A member sees exactly the tabs they can open.
 */
const TABS: { feature: FeatureKey; tab: SectionLinkTab }[] = [
  {
    feature: "attendance",
    tab: { label: "Weekly", href: "/dashboard/attendance", match: "exact" },
  },
  {
    feature: "attendance",
    tab: { label: "Services", href: "/dashboard/attendance/services", match: "prefix" },
  },
  {
    feature: "checkin",
    tab: { label: "Kids check-in", href: "/dashboard/checkin", match: "prefix" },
  },
  {
    feature: "attendance_follow_up",
    tab: { label: "Follow-up", href: "/dashboard/attendance/follow-up", match: "prefix" },
  },
  {
    feature: "attendance",
    tab: { label: "Setup", href: "/dashboard/attendance/setup", match: "prefix" },
  },
];

export function attendanceSectionTabs(allowed: readonly FeatureKey[]): SectionLinkTab[] {
  return TABS.filter(({ feature }) => allowed.includes(feature)).map(({ tab }) => tab);
}
