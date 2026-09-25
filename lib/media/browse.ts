/**
 * Turns a church's library rows into the shelf contract.
 *
 * Split from `lib/media/shelves.ts` on purpose: that file is pure and testable
 * without a database, this one is the adapter that feeds it. Keeping the join
 * out of the assembly rules is what will let the mobile handler and the public
 * website reuse `assembleBrowse` without inheriting the dashboard's queries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assembleBrowse,
  type BrowseItemInput,
  type BrowseLinks,
  type BrowseSeriesInput,
  type MediaBrowse,
} from "@/lib/media/shelves";
import {
  listMediaItems,
  listMediaSeries,
  type MediaItem,
  type MediaSeries,
} from "@/lib/stream/media-library";

export function toBrowseItem(item: MediaItem): BrowseItemInput {
  return {
    id: item.id,
    title: item.title,
    // The dashboard reads the library table directly and has no publication
    // timestamp on it, so recording date is the ordering key here. The mobile
    // projections order by `mobile_published_at` instead, which is correct for
    // them: staff care when a service happened, visitors when it appeared.
    publishedAt: null,
    recordedAt: item.createdAt,
    durationSec: item.durationSec,
    visibility: item.visibility,
    seriesId: item.seriesId,
    seriesName: item.seriesName,
    seriesSlug: item.seriesSlug,
    artwork: item.artwork,
    seriesArtwork: item.seriesArtwork,
    legacyPosterUrl: item.legacyPosterUrl,
    speakers: item.tags.speakers,
    chapters: item.tags.chapters,
    topics: item.tags.topics,
  };
}

/**
 * Counts visible items per series from the items already loaded, rather than
 * asking the database.
 *
 * The dashboard has the whole library in memory by this point, so a second
 * round trip would buy nothing — and counting from the same array the shelves
 * are built from means a tile's "8 messages" can never disagree with what
 * opening it shows.
 */
export function toBrowseSeries(
  series: MediaSeries[],
  items: BrowseItemInput[],
): BrowseSeriesInput[] {
  const counts = new Map<string, { count: number; latest: string | null }>();

  for (const item of items) {
    if (!item.seriesId) continue;
    const entry = counts.get(item.seriesId) ?? { count: 0, latest: null };
    entry.count += 1;
    const at = item.publishedAt ?? item.recordedAt;
    if (!entry.latest || at > entry.latest) entry.latest = at;
    counts.set(item.seriesId, entry);
  }

  return series
    .filter((entry): entry is MediaSeries & { slug: string } => Boolean(entry.slug))
    .map((entry) => {
      const tally = counts.get(entry.id);
      return {
        id: entry.id,
        slug: entry.slug,
        name: entry.name,
        description: entry.description,
        artwork: entry.artwork,
        itemCount: tally?.count ?? 0,
        latestAt: tally?.latest ?? null,
      };
    });
}

/**
 * Route builders for the staff dashboard. Everything lives under the
 * Recordings tab, so opening a tile never moves the highlighted tab; the old
 * `/dashboard/live-streaming/media/**` addresses redirect here.
 */
export const DASHBOARD_MEDIA_LINKS: BrowseLinks = {
  itemBase: "/dashboard/live-streaming/recordings",
  seriesBase: "/dashboard/live-streaming/recordings/series",
  topicBase: "/dashboard/live-streaming/recordings/tag/topic",
  speakerBase: "/dashboard/live-streaming/recordings/tag/speaker",
  allSeries: "/dashboard/live-streaming/recordings/series",
  allItems: "/dashboard/live-streaming/recordings",
  // The dashboard's live surface is the Go live tab, not a watch page, so the
  // featured slot never points at a stream from here.
  live: null,
};

export type LibraryBrowse = {
  browse: MediaBrowse;
  items: BrowseItemInput[];
  series: BrowseSeriesInput[];
};

export async function loadLibraryBrowse(
  churchId: string,
  links: BrowseLinks = DASHBOARD_MEDIA_LINKS,
  supabase?: SupabaseClient,
): Promise<LibraryBrowse> {
  const [rawItems, rawSeries] = await Promise.all([
    listMediaItems(churchId, supabase),
    listMediaSeries(churchId, supabase),
  ]);

  const items = rawItems.map(toBrowseItem);
  const series = toBrowseSeries(rawSeries, items);

  return {
    browse: assembleBrowse({ items, series, live: null, links }),
    items,
    series,
  };
}
