import { getCanonicalSiteUrl, getRecordingWatchUrl } from "@/lib/site-url";
import type { SiteProfile } from "@/types/site";

type Row = Record<string, unknown>;

/** Merge the existing website links with the canonical published-recording projection. */
export function websiteSermonMedia(input: { churchId: string; slug: string; links: Row[] | null; recordings: Row[] | null }): SiteProfile["media"] {
  const links = (input.links ?? []).map(row => ({
    id: row.id as string, title: row.title as string,
    series: (row.series as string | null) ?? null,
    speaker: (row.speaker as string | null) ?? null,
    date: (row.published_at as string | null) ?? null,
    videoUrl: (row.video_url as string | null) ?? null,
    thumbnail: row.thumbnail_url ? { src: row.thumbnail_url as string, alt: row.title as string } : null,
  }));
  const recordings = (input.recordings ?? [])
    .filter(row => row.church_id === input.churchId && row.listed === true)
    .map(row => ({
      id: `recording:${row.id}`, title: row.title as string,
      series: (row.series_name as string | null) ?? null,
      speaker: ((row.speakers as string[] | null) ?? []).join(", ") || null,
      date: (row.recorded_at as string | null) ?? null,
      videoUrl: getRecordingWatchUrl(input.slug, row.id as string),
      thumbnail: row.poster_url ? { src: row.poster_url as string, alt: row.title as string } : null,
    }));
  const seen = new Set<string>();
  const key = (href: string) => {
    try { return new URL(href, getCanonicalSiteUrl()).href; } catch { return href; }
  };
  return [...links, ...recordings].filter(item => {
    const identity = item.videoUrl ? key(item.videoUrl) : item.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0)).slice(0, 12);
}
