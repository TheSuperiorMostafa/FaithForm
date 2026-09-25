import type { SectionLinkTab } from "@/components/dashboard/section-link-tabs";
import type { FeatureKey } from "@/lib/features/catalog";

/**
 * Attendance is one section with one set of tabs, wherever in it you are.
 *
 * Each tab is still granted by its own feature: counting a Sunday is volunteer
 * work (`attendance`), who gets a follow-up text is the pastor's
 * (`attendance_follow_up`). A member sees exactly the tabs they can open.
 *
 * Kids Check-in is not a tab here: it is used at speed while families arrive,
 * so it has its own row in the sidebar.
 *
 * The order is the week's order: count who came, follow up with who didn't,
 * then the services themselves and the one-time setup that feeds them.
 */
const TABS: { feature: FeatureKey; tab: SectionLinkTab }[] = [
  {
    feature: "attendance",
    tab: { label: "Sunday count", href: "/dashboard/attendance", match: "exact" },
  },
  {
    feature: "attendance_follow_up",
    tab: { label: "Follow-up", href: "/dashboard/attendance/follow-up", match: "prefix" },
  },
  {
    feature: "attendance",
    tab: { label: "Services", href: "/dashboard/attendance/services", match: "prefix" },
  },
  {
    feature: "attendance",
    tab: { label: "Setup", href: "/dashboard/attendance/setup", match: "prefix" },
  },
];

export function attendanceSectionTabs(allowed: readonly FeatureKey[]): SectionLinkTab[] {
  return TABS.filter(({ feature }) => allowed.includes(feature)).map(({ tab }) => tab);
}
