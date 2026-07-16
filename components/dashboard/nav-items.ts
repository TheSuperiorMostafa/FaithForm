import {
  BookOpen,
  Contact,
  FileText,
  Film,
  Heart,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Phone,
  PhoneCall,
  RadioTower,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortLabel?: string;
  /** Hide from mobile bottom nav (sidebar only). */
  sidebarOnly?: boolean;
};

export const navItems: NavItem[] = [
  {
    label: "Dashboard",
    shortLabel: "Home",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Attendance",
    shortLabel: "Attend",
    href: "/dashboard/attendance",
    icon: Users,
  },
  {
    label: "People",
    shortLabel: "People",
    href: "/dashboard/people",
    icon: Contact,
  },
  {
    label: "Announcements",
    shortLabel: "News",
    href: "/dashboard/announcements",
    icon: Megaphone,
  },
  {
    label: "Live Streaming",
    shortLabel: "Live",
    href: "/dashboard/live-streaming",
    icon: RadioTower,
    sidebarOnly: true,
  },
  {
    label: "Media",
    shortLabel: "Media",
    href: "/dashboard/media",
    icon: Film,
    sidebarOnly: true,
  },
  {
    label: "Voice Assistant",
    shortLabel: "Voice",
    href: "/dashboard/voice-assistant",
    icon: Phone,
  },
  {
    label: "Call Log",
    shortLabel: "Calls",
    href: "/dashboard/call-log",
    icon: PhoneCall,
  },
  {
    label: "Sermon Builder",
    shortLabel: "Sermon",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
  },
  {
    label: "Giving",
    shortLabel: "Give",
    href: "/dashboard/giving",
    icon: Heart,
  },
  {
    label: "Documents",
    shortLabel: "Docs",
    href: "/dashboard/library",
    icon: FileText,
  },
];

/** Utility links pinned near the user footer (above Admin). */
export const utilityNavItems: NavItem[] = [
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
