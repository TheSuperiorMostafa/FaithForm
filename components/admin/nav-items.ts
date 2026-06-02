import {
  BarChart3,
  Building2,
  HelpCircle,
  LayoutDashboard,
  Users,
} from "lucide-react";

export const adminNavItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/churches", label: "Churches", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/support", label: "Support", icon: HelpCircle },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
];
