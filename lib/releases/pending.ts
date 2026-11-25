import type { FeatureKey } from "@/lib/features/catalog";
import {
  WHATS_NEW_RECENT_DAYS,
  type WhatsNewItem,
  type WhatsNewLink,
  type WhatsNewRelease,
} from "@/lib/releases/whats-new";

/** One item as the pop-up draws it: at most one link, already checked. */
export type PendingWhatsNewItem = {
  id: string;
  title: string;
  body: string;
  link: { href: string; label: string } | null;
};

export type PendingWhatsNew = {
  releaseId: string;
  title: string;
  date: string;
  items: PendingWhatsNewItem[];
  /**
   * Everything the person is being told about now, including unseen items of
   * older recent releases this one supersedes. Dismissing marks all of them,
   * so nobody gets two pop-ups in a row.
   */
  itemIds: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function releaseTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function isRecentRelease(release: WhatsNewRelease, now: Date): boolean {
  const started = releaseTime(release.date);
  if (Number.isNaN(started)) return false;
  return now.getTime() - started <= WHATS_NEW_RECENT_DAYS * DAY_MS;
}

export function itemVisible(item: WhatsNewItem, allowed: ReadonlySet<FeatureKey>): boolean {
  if (item.feature === undefined) return true;
  const keys: readonly FeatureKey[] = typeof item.feature === "string" ? [item.feature] : item.feature;
  return keys.some((key) => allowed.has(key));
}

function firstOpenLink(
  links: readonly WhatsNewLink[] | undefined,
  allowed: ReadonlySet<FeatureKey>,
): { href: string; label: string } | null {
  const link = links?.find((candidate) => !candidate.feature || allowed.has(candidate.feature));
  return link ? { href: link.href, label: link.label } : null;
}

/**
 * What to show one staff member, or null for no pop-up.
 *
 * Only recent releases count. An item counts when one of its features is open
 * to this person (account switch on and their own access) and they have not
 * dismissed it yet. The newest release with such items is the one shown; a
 * feature switched on later makes its item appear while the release is recent.
 */
export function pendingWhatsNew(
  releases: readonly WhatsNewRelease[],
  allowedFeatures: readonly FeatureKey[],
  seenItemIds: ReadonlySet<string>,
  now: Date = new Date(),
): PendingWhatsNew | null {
  const allowed = new Set(allowedFeatures);
  const recent = releases
    .filter((release) => isRecentRelease(release, now))
    .sort((a, b) => releaseTime(b.date) - releaseTime(a.date));

  let shown: PendingWhatsNew | null = null;
  const itemIds: string[] = [];

  for (const release of recent) {
    const unseen = release.items.filter((item) => itemVisible(item, allowed) && !seenItemIds.has(item.id));
    if (unseen.length === 0) continue;
    itemIds.push(...unseen.map((item) => item.id));
    shown ??= {
      releaseId: release.id,
      title: release.title,
      date: release.date,
      items: unseen.map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        link: firstOpenLink(item.links, allowed),
      })),
      itemIds: [],
    };
  }

  return shown ? { ...shown, itemIds } : null;
}

/** Every item id that exists, so a dismissal can only store real ids. */
export function knownItemIds(releases: readonly WhatsNewRelease[]): Set<string> {
  return new Set(releases.flatMap((release) => release.items.map((item) => item.id)));
}
