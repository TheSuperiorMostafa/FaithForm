/**
 * The shelf contract: one description of a media browse screen, rendered by
 * every surface.
 *
 * ## Why a contract rather than three screens
 *
 * A church's media library has to appear on the dashboard, on the church
 * website, in the iOS app, in the Android app and — once they exist — on four
 * TV platforms. Written as screens, that is eight places that each decide how
 * many series to show, whether an untitled recording says "Service recording"
 * or nothing, and what happens when a church has three items and no artwork.
 * They drift within a release, and the drift is always visible to the church
 * before it is visible to us.
 *
 * Written as a contract, the decisions are made once, here, in pure functions
 * over plain data. A surface's only job is to draw a tile.
 *
 * ## What is deliberately not in here
 *
 * Nothing in this file reads a database, and nothing in it knows a church id.
 * `assembleBrowse` takes rows and returns shelves. That is what makes the
 * ordering rules testable without a Postgres instance, and what will let the
 * mobile handler reuse them rather than reimplement them in Swift.
 */

import {
  bestArtwork,
  hasAnyArtwork,
  resolveArtwork,
  type ArtworkCrop,
  type ArtworkSet,
} from "@/lib/media/artwork";

// ---------------------------------------------------------------------------
// TILES
// ---------------------------------------------------------------------------

export type TileArtwork = { url: string; crop: ArtworkCrop };

export type MediaTile = {
  id: string;
  kind: "item" | "series" | "tag";
  title: string;
  /** One line under the title. Null renders nothing, never an empty line. */
  subtitle: string | null;
  href: string;
  /**
   * Null is a real and expected answer, not a failure. A church with no
   * artwork gets a typographic card; `tokens.json` is explicit that nothing
   * ships placeholder imagery.
   */
  artwork: TileArtwork | null;
  durationSec: number | null;
  /** 0–1. Only ever set from device-local progress. See `withContinueShelf`. */
  progress: number | null;
  /** Short status word — "Live", "Unlisted". Not a category label. */
  badge: string | null;
};

/** The shape a shelf asks its tiles to be drawn at. */
export type ShelfShape = "poster" | "wide" | "banner" | "row";

export type ShelfKind =
  | "continue"
  | "recent"
  | "series"
  | "topic"
  | "speaker"
  | "curated";

export type MediaShelf = {
  id: string;
  kind: ShelfKind;
  title: string;
  shape: ShelfShape;
  tiles: MediaTile[];
  viewAll: { label: string; href: string } | null;
};

/**
 * The one item above the shelves.
 *
 * `state` exists so a surface can say "this is on air now" without a second
 * request, and so it can render nothing at all on a Tuesday rather than an
 * empty frame — the same three-state rule `mobile_media_live` already applies.
 */
export type MediaFeatured = {
  state: "live" | "upcoming" | "latest";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  artwork: TileArtwork | null;
  startsAt: string | null;
};

export type MediaBrowse = {
  featured: MediaFeatured | null;
  shelves: MediaShelf[];
  /** True when the church has published nothing at all. Surfaces show copy. */
  empty: boolean;
};

// ---------------------------------------------------------------------------
// INPUTS
// ---------------------------------------------------------------------------

export type BrowseItemInput = {
  id: string;
  title: string | null;
  publishedAt: string | null;
  recordedAt: string;
  durationSec: number | null;
  visibility: "public" | "unlisted";
  seriesId: string | null;
  seriesName: string | null;
  seriesSlug: string | null;
  artwork: Partial<ArtworkSet> | null;
  seriesArtwork: Partial<ArtworkSet> | null;
  legacyPosterUrl: string | null;
  speakers: string[];
  chapters: string[];
  topics: string[];
};

export type BrowseSeriesInput = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  artwork: Partial<ArtworkSet> | null;
  itemCount: number;
  latestAt: string | null;
};

export type BrowseLiveInput = {
  state: "live" | "upcoming";
  id: string;
  title: string | null;
  startsAt: string | null;
  artwork: Partial<ArtworkSet> | null;
  legacyPosterUrl: string | null;
};

export type BrowseLinks = {
  /** Serializable prefixes: this contract crosses a Server/Client boundary. */
  itemBase: string;
  seriesBase: string;
  topicBase: string;
  speakerBase: string;
  allSeries: string;
  allItems: string;
  live: string | null;
};

function href(base: string, value: string): string {
  return `${base}/${encodeURIComponent(value)}`;
}

// ---------------------------------------------------------------------------
// FORMATTING
// ---------------------------------------------------------------------------

/**
 * A recording the relay named and nobody renamed.
 *
 * The fallback lives here rather than in each surface because the projections
 * in SQL already apply the same string, and two different fallbacks for the
 * same row is the kind of difference a church notices and we do not.
 */
export const UNTITLED_ITEM = "Service recording";

export function itemTitle(item: { title: string | null }): string {
  const trimmed = item.title?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : UNTITLED_ITEM;
}

/** "38 min", "1 hr 12 min", or null when the length is not known. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 1) return null;
  const total = Math.round(seconds / 60);
  if (total < 60) return `${Math.max(1, total)} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/** "8 messages", and "1 message" rather than "1 messages". */
export function formatItemCount(count: number): string {
  return count === 1 ? "1 message" : `${count} messages`;
}

function itemSubtitle(item: BrowseItemInput, showSeries: boolean): string | null {
  const parts: string[] = [];
  if (showSeries && item.seriesName) parts.push(item.seriesName);
  if (item.speakers[0]) parts.push(item.speakers[0]);
  const duration = formatDuration(item.durationSec);
  if (duration) parts.push(duration);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// TILE BUILDERS
// ---------------------------------------------------------------------------

export function itemTile(
  item: BrowseItemInput,
  links: BrowseLinks,
  options: { shape: ShelfShape; showSeries?: boolean } = { shape: "poster" },
): MediaTile {
  const artwork = resolveArtwork(item.artwork, item.seriesArtwork, item.legacyPosterUrl);
  const preferred: ArtworkCrop = options.shape === "poster" ? "poster" : "wide";

  return {
    id: item.id,
    kind: "item",
    title: itemTitle(item),
    subtitle: itemSubtitle(item, options.showSeries ?? true),
    href: href(links.itemBase, item.id),
    artwork: bestArtwork(artwork as ArtworkSet, preferred),
    durationSec: item.durationSec,
    progress: null,
    badge: item.visibility === "unlisted" ? "Unlisted" : null,
  };
}

export function seriesTile(series: BrowseSeriesInput, links: BrowseLinks): MediaTile {
  const artwork = resolveArtwork(series.artwork, null, null);
  return {
    id: series.id,
    kind: "series",
    title: series.name,
    subtitle: formatItemCount(series.itemCount),
    href: href(links.seriesBase, series.slug),
    artwork: bestArtwork(artwork as ArtworkSet, "poster"),
    durationSec: null,
    progress: null,
    badge: null,
  };
}

function tagTile(
  label: string,
  count: number,
  href: string,
  kindLabel: "topic" | "speaker",
): MediaTile {
  return {
    id: `${kindLabel}:${label.toLowerCase()}`,
    kind: "tag",
    title: label,
    subtitle: formatItemCount(count),
    href,
    // Tags have no artwork and are not going to get any. A topic shelf is a
    // row of words by design, which is also why it renders at `row` shape.
    artwork: null,
    durationSec: null,
    progress: null,
    badge: null,
  };
}

// ---------------------------------------------------------------------------
// TAG COUNTING
// ---------------------------------------------------------------------------

/**
 * Counts a tag axis, case-insensitively, keeping the spelling a church used
 * most often.
 *
 * Case folding matters more than it looks: "Prayer" and "prayer" typed into the
 * tag box on different Sundays are one topic to a congregation and two shelves
 * to a naive `group by`. The winning spelling is the most frequent one rather
 * than the first seen, so one typo in January does not name the topic all year.
 */
export function countTags(
  items: BrowseItemInput[],
  axis: "topics" | "speakers",
): Array<{ label: string; count: number }> {
  const spellings = new Map<string, Map<string, number>>();

  for (const item of items) {
    for (const raw of item[axis]) {
      const label = raw.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const variants = spellings.get(key) ?? new Map<string, number>();
      variants.set(label, (variants.get(label) ?? 0) + 1);
      spellings.set(key, variants);
    }
  }

  const counted = [...spellings.values()].map((variants) => {
    let best = "";
    let bestCount = 0;
    let total = 0;
    for (const [label, count] of variants) {
      total += count;
      // `>` not `>=` so ties keep the earlier-inserted spelling, making the
      // result stable for a given input rather than dependent on map order.
      if (count > bestCount) {
        best = label;
        bestCount = count;
      }
    }
    return { label: best, count: total };
  });

  return counted.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// ASSEMBLY
// ---------------------------------------------------------------------------

/** How many tiles each automatic shelf carries. Matched to one screen's scroll. */
export const SHELF_LIMITS = {
  recent: 12,
  series: 12,
  topics: 12,
  speakers: 10,
} as const;

/**
 * Builds the browse screen.
 *
 * ## Why a shelf can be dropped entirely
 *
 * Every shelf here is omitted when it would carry fewer tiles than it needs to
 * read as a shelf. A "Topics" row holding one word is worse than no row: it
 * looks like a bug, and it teaches the church that the feature is broken. The
 * thresholds are low — two for series and topics — but they are not zero, and
 * they are not one.
 *
 * ## Why "Continue watching" is not built here
 *
 * It cannot be. FaithForm keeps resume positions on the device and has no
 * server record of what any person watched, which is a deliberate constraint
 * documented in `docs/faithform/P9_NATIVE_MEDIA_EXPERIENCE.md`. A server
 * assembling that shelf would need exactly the history this product has
 * decided not to keep. `withContinueShelf` adds it on the client instead.
 */
export function assembleBrowse(input: {
  items: BrowseItemInput[];
  series: BrowseSeriesInput[];
  live: BrowseLiveInput | null;
  links: BrowseLinks;
}): MediaBrowse {
  const { items, series, live, links } = input;

  // Newest first, by publication where a church set one and by recording date
  // otherwise. A recording published late still belongs where it was published.
  const sorted = [...items].sort((a, b) => {
    const left = a.publishedAt ?? a.recordedAt;
    const right = b.publishedAt ?? b.recordedAt;
    return right.localeCompare(left);
  });

  const featured = buildFeatured(sorted, live, links);
  const shelves: MediaShelf[] = [];

  // Recently added. Skips whatever is already in the featured slot rather than
  // showing it twice a few hundred pixels apart.
  const recent = sorted
    .filter((item) => !(featured?.state === "latest" && featured.id === item.id))
    .slice(0, SHELF_LIMITS.recent);

  if (recent.length > 0) {
    shelves.push({
      id: "recent",
      kind: "recent",
      title: "Recently added",
      shape: "poster",
      tiles: recent.map((item) => itemTile(item, links, { shape: "poster" })),
      viewAll:
        sorted.length > recent.length
          ? { label: "View all", href: links.allItems }
          : null,
    });
  }

  const withItems = series
    .filter((entry) => entry.itemCount > 0)
    .sort((a, b) => (b.latestAt ?? "").localeCompare(a.latestAt ?? ""));

  if (withItems.length >= 2) {
    shelves.push({
      id: "series",
      kind: "series",
      title: "Series",
      shape: "poster",
      tiles: withItems.slice(0, SHELF_LIMITS.series).map((entry) => seriesTile(entry, links)),
      viewAll:
        withItems.length > SHELF_LIMITS.series
          ? { label: "All series", href: links.allSeries }
          : null,
    });
  }

  const topics = countTags(sorted, "topics").slice(0, SHELF_LIMITS.topics);
  if (topics.length >= 2) {
    shelves.push({
      id: "topics",
      kind: "topic",
      title: "Topics",
      shape: "row",
      tiles: topics.map((topic) =>
        tagTile(topic.label, topic.count, href(links.topicBase, topic.label), "topic"),
      ),
      viewAll: null,
    });
  }

  const speakers = countTags(sorted, "speakers").slice(0, SHELF_LIMITS.speakers);
  // Two is the threshold that matters most here. Almost every church has one
  // preacher, and a "Speakers" shelf with only the senior pastor on it is
  // noise on every screen it appears on.
  if (speakers.length >= 2) {
    shelves.push({
      id: "speakers",
      kind: "speaker",
      title: "Speakers",
      shape: "row",
      tiles: speakers.map((speaker) =>
        tagTile(speaker.label, speaker.count, href(links.speakerBase, speaker.label), "speaker"),
      ),
      viewAll: null,
    });
  }

  return {
    featured,
    shelves,
    empty: sorted.length === 0 && live === null,
  };
}

function buildFeatured(
  sorted: BrowseItemInput[],
  live: BrowseLiveInput | null,
  links: BrowseLinks,
): MediaFeatured | null {
  if (live && links.live) {
    const artwork = resolveArtwork(live.artwork, null, live.legacyPosterUrl);
    return {
      state: live.state,
      id: live.id,
      title: live.title?.trim() || (live.state === "live" ? "Live now" : "Upcoming service"),
      subtitle: null,
      href: links.live,
      artwork: bestArtwork(artwork as ArtworkSet, "wide"),
      startsAt: live.startsAt,
    };
  }

  const latest = sorted[0];
  if (!latest) return null;

  const artwork = resolveArtwork(latest.artwork, latest.seriesArtwork, latest.legacyPosterUrl);

  // A featured slot is a large picture. Without one it is a large empty
  // rectangle, and the shelves below — which handle missing artwork gracefully
  // at tile size — are a better first impression than that.
  if (!hasAnyArtwork(artwork as ArtworkSet)) return null;

  return {
    state: "latest",
    id: latest.id,
    title: itemTitle(latest),
    subtitle: itemSubtitle(latest, true),
    href: href(links.itemBase, latest.id),
    artwork: bestArtwork(artwork as ArtworkSet, "wide"),
    startsAt: null,
  };
}

// ---------------------------------------------------------------------------
// CONTINUE WATCHING, ON THE CLIENT ONLY
// ---------------------------------------------------------------------------

export type LocalProgress = {
  itemId: string;
  positionSec: number;
  durationSec: number | null;
  updatedAt: number;
};

/** Below this, someone opened it and changed their mind. */
const RESUME_MIN_SEC = 30;
/** Above this fraction, they finished it. Offering to resume the credits is noise. */
const RESUME_MAX_FRACTION = 0.95;
const CONTINUE_SHELF_LIMIT = 10;

/**
 * Prepends a "Continue watching" shelf built entirely from device-local
 * progress.
 *
 * Runs on the client, against a browse payload the server built without any
 * knowledge of what this person has watched. That asymmetry is the whole point:
 * the shelf is a projection of a record the device owns, so it works
 * per-device, does not follow anyone between devices, and leaves no history on
 * a server to be requested, subpoenaed or leaked.
 *
 * It can only resume items present in the payload. An item watched six months
 * ago that is not in the supplied item set will not reappear here, and
 * fetching it by id would mean telling the server which items this person had
 * watched — which is the one thing this design will not do.
 */
export function withContinueShelf(
  browse: MediaBrowse,
  progress: LocalProgress[],
  links: BrowseLinks,
  items: BrowseItemInput[],
): MediaBrowse {
  if (progress.length === 0) return browse;

  // Build from the item payload rather than scraping the visible shelves. The
  // newest item may have been promoted into the featured slot and deliberately
  // removed from "Recently added"; it must still be resumable.
  const byId = new Map(
    items.map((entry) => [entry.id, itemTile(entry, links, { shape: "wide" })]),
  );

  const resumable = [...progress]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => {
      const tile = byId.get(entry.itemId);
      if (!tile) return false;
      if (entry.positionSec < RESUME_MIN_SEC) return false;
      const total = entry.durationSec ?? tile.durationSec;
      if (total && entry.positionSec / total > RESUME_MAX_FRACTION) return false;
      return true;
    })
    .slice(0, CONTINUE_SHELF_LIMIT);

  if (resumable.length === 0) return browse;

  const tiles: MediaTile[] = resumable.map((entry) => {
    const tile = byId.get(entry.itemId) as MediaTile;
    const total = entry.durationSec ?? tile.durationSec;
    const remaining = total ? Math.max(0, total - entry.positionSec) : null;
    const remainingLabel = formatDuration(remaining);

    return {
      ...tile,
      href: href(links.itemBase, entry.itemId),
      subtitle: remainingLabel ? `${remainingLabel} left` : tile.subtitle,
      progress: total && total > 0 ? Math.min(1, entry.positionSec / total) : null,
    };
  });

  return {
    ...browse,
    shelves: [
      {
        id: "continue",
        kind: "continue",
        title: "Continue watching",
        shape: "wide",
        tiles,
        viewAll: null,
      },
      ...browse.shelves,
    ],
  };
}
