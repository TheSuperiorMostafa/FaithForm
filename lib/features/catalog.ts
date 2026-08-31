import {
  BookOpen,
  Contact,
  FolderOpen,
  Globe,
  Heart,
  HeartHandshake,
  Megaphone,
  Phone,
  RadioTower,
  Smartphone,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * The single source of truth for gateable product areas.
 *
 * Two independent switches decide whether someone sees a feature:
 *   1. Account level  — a platform admin turns the feature on/off for a church
 *                       (`church_features`). Off means nobody in that church
 *                       sees it, admins included.
 *   2. User level     — a church admin grants individual members access
 *                       (`church_users.feature_permissions`). Church admins
 *                       implicitly hold every grant.
 *
 * Effective access = account enabled AND (church admin OR explicit grant).
 */
export const FEATURE_KEYS = [
  "attendance",
  "attendance_follow_up",
  "people",
  "announcements",
  "sermon_builder",
  "live_stream",
  "voice_assistant",
  "giving",
  "library",
  "website",
  "member_app",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureDefinition = {
  key: FeatureKey;
  label: string;
  description: string;
  /** Primary destination for this feature. */
  href: string;
  icon: LucideIcon;
  /**
   * Every dashboard route prefix the feature owns. Used by route guards and by
   * nav filtering, so nested pages (e.g. /dashboard/giving/donors) are covered
   * without listing them one by one.
   */
  routes: string[];
  /**
   * What visitors lose when this is switched off, for the features that reach
   * past the dashboard. Rendered on the toggle so a platform admin is told the
   * consequence before flipping it rather than discovering it from a church.
   *
   * Absent means the feature is staff-facing only and switching it off is
   * invisible to the public.
   */
  publicImpact?: string;
};

export const FEATURES: FeatureDefinition[] = [
  {
    key: "attendance",
    label: "Attendance",
    description: "Mark who came on Sunday and submit the weekly count.",
    href: "/dashboard/attendance",
    icon: Users,
    routes: ["/dashboard/attendance"],
  },
  {
    key: "attendance_follow_up",
    label: "Follow-up",
    description:
      "Pastor-only. Pick which absentees get a check-in text after a service.",
    href: "/dashboard/attendance/follow-up",
    icon: HeartHandshake,
    routes: ["/dashboard/attendance/follow-up"],
  },
  {
    key: "people",
    label: "People",
    description: "Member directory and contact records.",
    href: "/dashboard/people",
    icon: Contact,
    routes: ["/dashboard/people"],
  },
  {
    key: "announcements",
    label: "Announcements",
    description:
      "Calendar queue, Facebook publishing, and the weekly Gmail draft.",
    href: "/dashboard/announcements",
    icon: Megaphone,
    routes: ["/dashboard/announcements"],
  },
  {
    key: "sermon_builder",
    label: "Sermon Builder",
    description: "AI sermon outlines, series planning, slides, and exports.",
    href: "/dashboard/sermon-builder",
    icon: BookOpen,
    routes: ["/dashboard/sermon-builder"],
  },
  {
    key: "live_stream",
    label: "Live Stream",
    description: "Broadcast production, relay destinations, and recordings.",
    href: "/dashboard/live-streaming",
    icon: RadioTower,
    routes: ["/dashboard/live-streaming"],
  },
  {
    key: "voice_assistant",
    label: "Voice Assistant",
    description: "AI phone answering, call log, and transcripts.",
    href: "/dashboard/voice-assistant",
    icon: Phone,
    routes: ["/dashboard/voice-assistant", "/dashboard/call-log"],
  },
  {
    key: "giving",
    label: "Giving",
    description: "Online giving, donors, recurring gifts, and statements.",
    href: "/dashboard/giving",
    icon: Heart,
    routes: ["/dashboard/giving"],
    publicImpact:
      "Takes the public giving page offline and stops new gifts. Existing recurring gifts keep running — donors can still pause or cancel them, but not restart or raise one.",
  },
  {
    key: "library",
    label: "Media & Documents",
    description: "Shared document library and uploaded media assets.",
    href: "/dashboard/library",
    icon: FolderOpen,
    routes: ["/dashboard/library", "/dashboard/media"],
  },
  {
    key: "website",
    label: "Website",
    description:
      "Public church website — page content, design, sermon feed, and visitor messages.",
    href: "/dashboard/website",
    icon: Globe,
    routes: ["/dashboard/website"],
    publicImpact:
      "Takes the church's public site offline on every connected domain, and stops the Visit form accepting messages.",
  },
  {
    key: "member_app",
    label: "Member App",
    description:
      "The church's presence in the Faithful app — discovery, join requests, and invitation links.",
    href: "/dashboard/app",
    icon: Smartphone,
    routes: ["/dashboard/app"],
    publicImpact:
      "Delists the church from search and Nearby in the member app, and stops new members joining or following. People already connected keep the app and its content.",
  },
];

const FEATURES_BY_KEY = new Map<FeatureKey, FeatureDefinition>(
  FEATURES.map((feature) => [feature.key, feature]),
);

export function getFeature(key: FeatureKey): FeatureDefinition {
  const feature = FEATURES_BY_KEY.get(key);
  if (!feature) throw new Error(`Unknown feature key: ${key}`);
  return feature;
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return (
    typeof value === "string" &&
    (FEATURE_KEYS as readonly string[]).includes(value)
  );
}

/** Keeps only recognised keys — stale grants in the DB are ignored, not trusted. */
export function parseFeatureKeys(values: unknown): FeatureKey[] {
  if (!Array.isArray(values)) return [];
  return values.filter(isFeatureKey);
}

/**
 * Which feature owns a dashboard path, if any. Routes not owned by a feature
 * (home, settings, church profile, support) are always reachable.
 *
 * The longest matching route wins, so a feature nested under another one keeps
 * its own permission: `/dashboard/attendance/follow-up` belongs to Follow-up
 * even though Attendance owns the `/dashboard/attendance` prefix.
 */
export function featureKeyForPath(pathname: string): FeatureKey | null {
  let match: { key: FeatureKey; length: number } | null = null;

  for (const feature of FEATURES) {
    for (const route of feature.routes) {
      if (pathname !== route && !pathname.startsWith(`${route}/`)) continue;
      if (!match || route.length > match.length) {
        match = { key: feature.key, length: route.length };
      }
    }
  }

  return match?.key ?? null;
}
