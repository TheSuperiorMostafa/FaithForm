import type { FeatureKey } from "@/lib/features/catalog";

/**
 * The "What's new" pop-up's content, newest release first.
 *
 * Adding a release means adding one entry at the top of `RELEASES`. Nothing
 * else changes: the dashboard shows each staff member the newest recent release
 * that still has items they haven't seen, filtered to the features they can
 * open. How to write entries: `.agents/skills/faithform-whats-new/SKILL.md`.
 *
 * Ids are stored against each person once they dismiss the pop-up
 * (`whats_new_reads`), so never rename or reuse an item id after it ships.
 */

export type WhatsNewLink = {
  href: string;
  /** Verb first, names the result: "Build a lesson", not "Click here". */
  label: string;
  /** Only offer this link to people who can open this feature. */
  feature?: FeatureKey;
};

export type WhatsNewItem = {
  /** `<release id>/<short-slug>`. Permanent once shipped. */
  id: string;
  /** A few words, benefit first. */
  title: string;
  /** One or two plain sentences: what it does for the church. */
  body: string;
  /**
   * The feature switch this item depends on. With a list, the item shows when
   * any one of them is on. Leave it out for something every church has.
   */
  feature?: FeatureKey | readonly FeatureKey[];
  /** Where to try it. The first link the person can open is shown. */
  links?: readonly WhatsNewLink[];
};

export type WhatsNewRelease = {
  /** `update-<n>`. Permanent once shipped. */
  id: string;
  /** Shown as the headline. A trailing number is set large: "Update 14". */
  title: string;
  /** Release day, YYYY-MM-DD. Releases older than the recent window never show. */
  date: string;
  items: readonly WhatsNewItem[];
};

/** How long after its date a release can still pop up, e.g. for a feature turned on later. */
export const WHATS_NEW_RECENT_DAYS = 60;

export const RELEASES: readonly WhatsNewRelease[] = [
  {
    id: "update-14",
    title: "Update 14",
    date: "2026-11-24",
    items: [
      {
        id: "update-14/lessons-from-sermons",
        title: "Lessons from your pastor's sermon",
        body:
          "Build a Sunday School or Bible Study lesson straight from the sermon, with a deep dive, discussion questions and the main points. It only uses what your pastor preached, so pastors, teachers and small groups can trust it.",
        feature: "sermon_builder",
        links: [{ href: "/dashboard/lesson-builder", label: "Build a lesson" }],
      },
      {
        id: "update-14/website-message-alerts",
        title: "Know the moment someone reaches out",
        body:
          "Get an email or a text when someone fills out a connection card on your church website. Choose how you hear about it in Notifications.",
        feature: "website",
        links: [{ href: "/dashboard/settings?tab=notifications", label: "Turn on alerts" }],
      },
      {
        id: "update-14/people-addresses-membership",
        title: "More about each person",
        body:
          "People now hold a home address and membership, so your member list keeps more of what you know about everyone.",
        feature: "people",
        links: [{ href: "/dashboard/people", label: "Open People" }],
      },
      {
        id: "update-14/google-maps-addresses",
        title: "Addresses that are easy to find",
        body:
          "Start typing an address for an event or a person and pick the right one from Google Maps.",
        feature: ["announcements", "people"],
        links: [
          { href: "/dashboard/announcements", label: "Add an event", feature: "announcements" },
          { href: "/dashboard/people", label: "Open People", feature: "people" },
        ],
      },
    ],
  },
];
