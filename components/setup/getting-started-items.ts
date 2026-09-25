import type { FeatureKey } from "@/lib/features/catalog";

import { CHURCH_INFO_HREF, CONNECTED_ACCOUNTS_HREF, GIVING_HREF, TEAM_HREF } from "./setup-copy";

/**
 * What Home's "Finish setting up" card knows about the church. Each value is
 * `true` (done), `false` (not done) or `null` (we could not tell). An unknown
 * item is left out rather than guessed at: the card must never nag about
 * something that is already done, and a failed check must never break Home.
 */
export type GettingStartedSignals = {
  hasServiceTimes: boolean | null;
  hasLogo: boolean | null;
  teamSize: number | null;
  hasCalendar: boolean | null;
  givingReady: boolean | null;
};

export type GettingStartedKey = "serviceTimes" | "logo" | "team" | "calendar" | "giving";

export type GettingStartedItem = {
  key: GettingStartedKey;
  title: string;
  description: string;
  href: string;
  cta: string;
};

export type GettingStartedPlan = {
  /** Only the items still to do, in the order a new church usually does them. */
  todo: GettingStartedItem[];
  /** How many of the items we could check are done. */
  doneCount: number;
  /** How many items we could check at all. */
  totalCount: number;
};

const ITEMS: Record<GettingStartedKey, GettingStartedItem> = {
  serviceTimes: {
    key: "serviceTimes",
    title: "Add your service times",
    description: "So your website and the FaithForm app show when to come.",
    href: CHURCH_INFO_HREF,
    cta: "Add times",
  },
  logo: {
    key: "logo",
    title: "Add your logo",
    description: "So everything FaithForm makes looks like your church.",
    href: CHURCH_INFO_HREF,
    cta: "Add logo",
  },
  team: {
    key: "team",
    title: "Invite your team",
    description: "Give staff and volunteers their own sign-in.",
    href: TEAM_HREF,
    cta: "Invite",
  },
  calendar: {
    key: "calendar",
    title: "Connect your calendar",
    description: "Bring in your Google or iCloud calendar events.",
    href: CONNECTED_ACCOUNTS_HREF,
    cta: "Connect",
  },
  giving: {
    key: "giving",
    title: "Set up online giving",
    description: "Add your bank details so people can give online.",
    href: GIVING_HREF,
    cta: "Set up",
  },
};

export const GETTING_STARTED_MAX_ITEMS = 5;

/** Pure: decides which items to show from what we know. */
export function planGettingStarted(
  signals: GettingStartedSignals,
  allowedFeatures: readonly FeatureKey[],
): GettingStartedPlan {
  const checks: [GettingStartedKey, boolean | null][] = [
    ["serviceTimes", signals.hasServiceTimes],
    ["logo", signals.hasLogo],
    ["team", signals.teamSize === null ? null : signals.teamSize > 1],
    ["calendar", signals.hasCalendar],
  ];
  if (allowedFeatures.includes("giving")) {
    checks.push(["giving", signals.givingReady]);
  }

  const known = checks.filter((check): check is [GettingStartedKey, boolean] => check[1] !== null);
  const todo = known
    .filter(([, done]) => !done)
    .map(([key]) => ITEMS[key])
    .slice(0, GETTING_STARTED_MAX_ITEMS);

  return {
    todo,
    doneCount: known.filter(([, done]) => done).length,
    totalCount: known.length,
  };
}
