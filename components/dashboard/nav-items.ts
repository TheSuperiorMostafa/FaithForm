import {
  BookOpen,
  Building2,
  Contact,
  Heart,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Phone,
  RadioTower,
  Settings,
  Users,
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
   * Gate this row behind a feature. Items without a key (Home, Church Profile,
   * Support, Settings) are always available.
   */
  feature?: FeatureKey;
};

/** Keeps nav in sync with route guards — hidden rows are also unreachable. */
export function filterNavByFeatures(
  items: NavItem[],
  allowed: FeatureKey[],
): NavItem[] {
  return items.filter((item) => !item.feature || allowed.includes(item.feature));
}

export const navItems: NavItem[] = [
  {
    label: "Home",
    shortLabel: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Attendance",
    shortLabel: "Attend",
    href: "/dashboard/attendance",
    icon: Users,
    feature: "attendance",
  },
  {
    label: "People",
    shortLabel: "People",
    href: "/dashboard/people",
    icon: Contact,
    feature: "people",
  },
  {
    label: "Announcements",
    shortLabel: "News",
    href: "/dashboard/announcements",
    icon: Megaphone,
    feature: "announcements",
  },
  {
    label: "Sermon Builder",
    shortLabel: "Sermon",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
    feature: "sermon_builder",
  },
  {
    label: "Live Stream",
    shortLabel: "Live",
    href: "/dashboard/live-streaming",
    icon: RadioTower,
    feature: "live_stream",
  },
  {
    label: "Voice Assistant",
    shortLabel: "Voice",
    href: "/dashboard/voice-assistant",
    icon: Phone,
    feature: "voice_assistant",
  },
  {
    label: "Giving",
    shortLabel: "Give",
    href: "/dashboard/giving",
    icon: Heart,
    feature: "giving",
  },
];

/** Church Profile lives in the sidebar footer as a full nav row. */
export const churchProfileNavItem: NavItem = {
  label: "Church Profile",
  shortLabel: "Profile",
  href: "/dashboard/church-profile",
  icon: Building2,
  sidebarOnly: true,
};

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

/** All footer utilities (profile + compact pills). */
export const utilityNavItems: NavItem[] = [
  churchProfileNavItem,
  ...footerUtilityNavItems,
];
