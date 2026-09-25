import {
  Baby,
  BookOpen,
  CircleHelp,
  ClipboardCheck,
  Globe,
  HandHeart,
  House,
  Megaphone,
  Phone,
  Settings,
  Smartphone,
  UserRound,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { FeatureKey } from "@/lib/features/catalog";

/**
 * Sidebar groups follow a church's week, not the database: the things done
 * every week first, then the church's presence online.
 */
export type NavGroup = "home" | "weekly" | "online";

export const NAV_GROUP_LABELS: Record<Exclude<NavGroup, "home">, string> = {
  weekly: "Every week",
  online: "Your church online",
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortLabel?: string;
  group?: NavGroup;
  /** Hide from the mobile bottom bar's first four slots (still under More). */
  sidebarOnly?: boolean;
  /**
   * Gate this row behind features: it shows when the member holds any one of
   * them. Attendance lists both of its grants, so a pastor with Follow-up only
   * still reaches the section (its layout forwards them to the right tab).
   * Items with no features (Home, Help, Settings) are always available.
   */
  features?: FeatureKey[];
  /**
   * Parts of this section that live at their own routes under their own
   * feature. The row is active on them too, and a member who holds only a
   * part's feature still sees the row — it takes them straight to that part.
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

/** The current row's label, for the topbar title. */
export function currentNavLabel(pathname: string): string | null {
  const all = [...navItems, ...footerUtilityNavItems];
  const hit = all.find((item) => isNavItemActive(pathname, item));
  return hit?.label ?? null;
}

export const navItems: NavItem[] = [
  {
    label: "Home",
    shortLabel: "Home",
    href: "/dashboard",
    icon: House,
    group: "home",
  },
  {
    label: "People",
    shortLabel: "People",
    href: "/dashboard/people",
    icon: UserRound,
    features: ["people"],
    group: "weekly",
  },
  {
    label: "Groups",
    shortLabel: "Groups",
    href: "/dashboard/groups",
    icon: Users,
    features: ["groups"],
    group: "weekly",
  },
  {
    label: "Announcements",
    shortLabel: "News",
    href: "/dashboard/announcements",
    icon: Megaphone,
    features: ["announcements"],
    group: "weekly",
  },
  {
    // Who came: the Sunday count, services and follow-up.
    label: "Attendance",
    shortLabel: "Attend",
    href: "/dashboard/attendance",
    icon: ClipboardCheck,
    features: ["attendance", "attendance_follow_up"],
    group: "weekly",
  },
  {
    // Its own row: used at speed while families are arriving, so it should be
    // one click from anywhere, not a tab inside another section's tabs.
    label: "Kids Check-in",
    shortLabel: "Check-in",
    href: "/dashboard/checkin",
    icon: Baby,
    features: ["checkin"],
    group: "weekly",
  },
  {
    label: "Live",
    shortLabel: "Live",
    href: "/dashboard/live-streaming",
    icon: Video,
    features: ["live_stream"],
    group: "weekly",
  },
  {
    label: "Sermons",
    shortLabel: "Sermons",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
    features: ["sermon_builder"],
    group: "weekly",
  },
  {
    label: "Giving",
    shortLabel: "Giving",
    href: "/dashboard/giving",
    icon: HandHeart,
    features: ["giving"],
    group: "online",
  },
  {
    label: "Website",
    shortLabel: "Website",
    href: "/dashboard/website",
    icon: Globe,
    features: ["website"],
    group: "online",
  },
  {
    label: "Church App",
    shortLabel: "App",
    href: "/dashboard/app",
    icon: Smartphone,
    features: ["member_app"],
    group: "online",
  },
  {
    // A pastor wants to read what the phone did, not tune what it is:
    // assistant configuration lives in the FaithForm control center.
    label: "Phone Calls",
    shortLabel: "Calls",
    href: "/dashboard/call-log",
    icon: Phone,
    features: ["voice_assistant"],
    group: "online",
  },
];

/** Always reachable, on every screen size (WCAG 3.2.6 consistent help). */
export const footerUtilityNavItems: NavItem[] = [
  {
    label: "Help",
    shortLabel: "Help",
    href: "/dashboard/support",
    icon: CircleHelp,
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
