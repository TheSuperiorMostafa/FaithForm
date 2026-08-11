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
   * Gate this row behind features — it shows when the member holds any one of
   * them. Attendance lists both of its grants, so a pastor with Follow-up only
   * still reaches the section (its layout forwards them to the right tab).
   * Items with no features (Home, Support, Settings) are always available.
   */
  features?: FeatureKey[];
};

/** Keeps nav in sync with route guards — hidden rows are also unreachable. */
export function filterNavByFeatures(
  items: NavItem[],
  allowed: FeatureKey[],
): NavItem[] {
  return items.filter(
    (item) =>
      !item.features?.length ||
      item.features.some((feature) => allowed.includes(feature)),
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
    label: "Attendance",
    shortLabel: "Attend",
    href: "/dashboard/attendance",
    icon: Users,
    features: ["attendance", "attendance_follow_up"],
  },
  {
    label: "People",
    shortLabel: "People",
    href: "/dashboard/people",
    icon: Contact,
    features: ["people"],
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
    label: "Voice Assistant",
    shortLabel: "Voice",
    href: "/dashboard/voice-assistant",
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
