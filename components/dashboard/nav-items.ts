import {
  BookOpen,
  FileText,
  Heart,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  Phone,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  shortLabel?: string;
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
    label: "Announcements",
    shortLabel: "News",
    href: "/dashboard/announcements",
    icon: Megaphone,
  },
  {
    label: "Voice Assistant",
    shortLabel: "Voice",
    href: "/dashboard/voice-assistant",
    icon: Phone,
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
  {
    label: "Support",
    shortLabel: "Help",
    href: "/dashboard/support",
    icon: LifeBuoy,
  },
  {
    label: "Settings",
    shortLabel: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
  },
];
