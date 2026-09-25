import {
  Baby,
  BookOpen,
  ClipboardCheck,
  HandHeart,
  Megaphone,
  MessageCircle,
  UserPlus,
  Video,
  type LucideIcon,
} from "lucide-react";

import { ActionCard, ActionGrid } from "@/components/ui/action-card";
import type { FeatureKey } from "@/lib/features/catalog";

type QuickAction = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  feature: FeatureKey;
  /** Moves to the front on Sundays, when it is what the day is about. */
  sunday?: boolean;
};

/**
 * The things a church does most, as big labelled tiles. Each goes straight to
 * the task, not to a section index.
 */
const ACTIONS: QuickAction[] = [
  {
    title: "Check kids in",
    description: "Families arriving now",
    href: "/dashboard/checkin",
    icon: Baby,
    feature: "checkin",
    sunday: true,
  },
  {
    title: "Go live",
    description: "Stream the service",
    href: "/dashboard/live-streaming",
    icon: Video,
    feature: "live_stream",
    sunday: true,
  },
  {
    title: "Record attendance",
    description: "Who came on Sunday",
    href: "/dashboard/attendance",
    icon: ClipboardCheck,
    feature: "attendance",
    sunday: true,
  },
  {
    title: "Post an announcement",
    description: "App, email and Facebook",
    href: "/dashboard/announcements?compose=1",
    icon: Megaphone,
    feature: "announcements",
  },
  {
    title: "Add a person",
    description: "Someone new to your church",
    href: "/dashboard/people?add=1",
    icon: UserPlus,
    feature: "people",
  },
  {
    title: "Message a group",
    description: "Send to a small group or team",
    href: "/dashboard/groups/messages",
    icon: MessageCircle,
    feature: "groups",
  },
  {
    title: "Build a sermon",
    description: "Scripture slides for Sunday",
    href: "/dashboard/sermon-builder/new",
    icon: BookOpen,
    feature: "sermon_builder",
  },
  {
    title: "See giving",
    description: "What came in this week",
    href: "/dashboard/giving",
    icon: HandHeart,
    feature: "giving",
  },
];

const MAX_TILES = 6;

/** Features that put at least one tile in this section. */
export const QUICK_ACTION_FEATURES: FeatureKey[] = ACTIONS.map((a) => a.feature);

export function hasQuickActions(allowedFeatures: FeatureKey[]): boolean {
  return QUICK_ACTION_FEATURES.some((key) => allowedFeatures.includes(key));
}

export function pickQuickActions(
  allowedFeatures: FeatureKey[],
  isSunday: boolean,
): QuickAction[] {
  const allowed = ACTIONS.filter((action) => allowedFeatures.includes(action.feature));
  const ordered = isSunday
    ? [...allowed.filter((a) => a.sunday), ...allowed.filter((a) => !a.sunday)]
    : [...allowed.filter((a) => !a.sunday), ...allowed.filter((a) => a.sunday)];
  return ordered.slice(0, MAX_TILES);
}

export function QuickActionsSection({
  allowedFeatures,
  isSunday,
}: {
  allowedFeatures: FeatureKey[];
  isSunday: boolean;
}) {
  const actions = pickQuickActions(allowedFeatures, isSunday);
  if (actions.length === 0) return null;

  return (
    <ActionGrid>
      {actions.map((action, index) => (
        <ActionCard
          key={action.href}
          href={action.href}
          icon={action.icon}
          title={action.title}
          description={action.description}
          tone={index === 0 ? "primary" : "default"}
        />
      ))}
    </ActionGrid>
  );
}
