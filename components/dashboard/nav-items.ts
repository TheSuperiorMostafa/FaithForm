import {
  BookOpen,
  Contact,
  Globe,
  Heart,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Phone,
  RadioTower,
  Settings,
  Smartphone,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@/lib/features/catalog";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortLabel?: string;
  /** Hide from mobile bottom nav (sidebar only). */
  sidebarOnly?: boolean;
  /**
   * Gate this row behind features: it shows when the member holds any one of
   * them. Attendance lists both of its grants, so a pastor with Follow-up only
   * still reaches the section (its layout forwards them to the right tab).
   * Items with no features (Home, Support, Settings) are always available.
   */
  features?: FeatureKey[];
  /**
   * Parts of this section that live at their own routes under their own
   * feature. The row is active on them too, and a member who holds only a
   * part's feature still sees the row — it takes them straight to that part.
   * Attendance lists Kids check-in this way: one section, several grants.
   */
  sections?: { href: string; features: FeatureKey[] }[];
};

/** Keeps nav in sync with route guards: hidden rows are also unreachable. */
export function filterNavByFeatures(
  items: NavItem[],
  allowed: FeatureKey[],
): NavItem[] {
  return items.flatMap((item) => {
    const own =
      !item.features?.length ||
      item.features.some((feature) => allowed.includes(feature));
    if (own) return [item];

    const part = item.sections?.find((section) =>
      section.features.some((feature) => allowed.includes(feature)),
    );
    return part ? [{ ...item, href: part.href }] : [];
  });
}

function isUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a row is the current section — its own route, or any of its parts. */
export function isNavItemActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return (
    isUnder(pathname, item.href) ||
    (item.sections ?? []).some((section) => isUnder(pathname, section.href))
  );
}

export const navItems: NavItem[] = [
  {
    label: "Home",
    shortLabel: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    // Check-ins are attendance. Kids check-in is a tab of this section rather
    // than a second sidebar row, so "Attendance" and "Check-In" no longer
    // read as two different things.
    label: "Attendance",
    shortLabel: "Attend",
    href: "/dashboard/attendance",
    icon: Users,
    features: ["attendance", "attendance_follow_up"],
    sections: [{ href: "/dashboard/checkin", features: ["checkin"] }],
  },
  {
    label: "People",
    shortLabel: "People",
    href: "/dashboard/people",
    icon: Contact,
    features: ["people"],
  },
  {
    label: "Groups",
    shortLabel: "Groups",
    href: "/dashboard/groups",
    icon: UsersRound,
    features: ["groups"],
  },
  {
    label: "Announcements",
    shortLabel: "News",
    href: "/dashboard/announcements",
    icon: Megaphone,
    features: ["announcements"],
  },
  {
    label: "Sermon Builder",
    shortLabel: "Sermon",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
    features: ["sermon_builder"],
  },
  {
    label: "Live Stream",
    shortLabel: "Live",
    href: "/dashboard/live-streaming",
    icon: RadioTower,
    features: ["live_stream"],
  },
  {
    // Assistant configuration lives in the control center now: a pastor wants
    // to read what the phone did, not tune what it is.
    label: "Call Log",
    shortLabel: "Calls",
    href: "/dashboard/call-log",
    icon: Phone,
    features: ["voice_assistant"],
  },
  {
    label: "Giving",
    shortLabel: "Give",
    href: "/dashboard/giving",
    icon: Heart,
    features: ["giving"],
  },
  {
    label: "Website",
    shortLabel: "Site",
    href: "/dashboard/website",
    icon: Globe,
    features: ["website"],
  },
  {
    label: "Member App",
    shortLabel: "App",
    href: "/dashboard/app",
    icon: Smartphone,
    features: ["member_app"],
  },
];

/** Compact footer pills (Support + Settings). */
export const footerUtilityNavItems: NavItem[] = [
  {
    label: "Support",
    shortLabel: "Help",
    href: "/dashboard/support",
    icon: LifeBuoy,
    sidebarOnly: true,
  },
  {
    label: "Settings",
    shortLabel: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    sidebarOnly: true,
  },
];
