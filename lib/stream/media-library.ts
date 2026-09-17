import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { artworkFromRow, EMPTY_ARTWORK, type ArtworkSet } from "@/lib/media/artwork";

export type MediaVisibility = "public" | "unlisted";
export type MediaViewKind = "live" | "replay";
export type MediaViewSource = "website" | "app" | "embed";

export type MediaSeries = {
  id: string;
  churchId: string;
  name: string;
  description: string | null;
  /** Null only on a database that has not run migration 0080 yet. */
  slug: string | null;
  artwork: ArtworkSet;
};

export type MediaTags = {
  speakers: string[];
  chapters: string[];
  topics: string[];
};

export type MediaItem = {
  id: string;
  title: string | null;
  createdAt: string;
  durationSec: number | null;
  visibility: MediaVisibility;
  storagePath: string;
  seriesId: string | null;
  seriesName: string | null;
  seriesSlug: string | null;
  tags: MediaTags;
  /** This item's own crops. Expected to be empty on most items. */
  artwork: ArtworkSet;
  /** The crops it inherits. Resolution order lives in `lib/media/artwork.ts`. */
  seriesArtwork: ArtworkSet;
  /** The single pre-0080 poster field, kept as the last fallback. */
  legacyPosterUrl: string | null;
};

export type MediaStats = {
  /** People who watched the service as it happened. */
  liveViews: number;
  liveUniqueViewers: number;
  /** People who came back to it afterwards, split by where from. */
  replayViews: number;
  replayUniqueViewers: number;
  replayBySource: Record<MediaViewSource, number>;
};

type ArtworkColumns = {
  artwork_poster_url?: string | null;
  artwork_wide_url?: string | null;
  artwork_banner_url?: string | null;
};

type SeriesRow = ArtworkColumns & {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
  slug?: string | null;
};

/** The embedded `media_series(...)` join, which PostgREST may return either way. */
type RelatedSeries = ArtworkColumns & {
  name?: string;
  slug?: string | null;
};

type RecordingRow = ArtworkColumns & {
  id: string;
  title: string | null;
  created_at: string;
  duration_sec: number | null;
  storage_path: string;
  visibility: string | null;
  series_id: string | null;
  speaker_tags: string[] | null;
  chapter_tags: string[] | null;
  topic_tags: string[] | null;
  stream_session_id: string | null;
  mobile_poster_url?: string | null;
  media_series?: RelatedSeries | RelatedSeries[] | null;
};

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

function relatedSeries(related: RecordingRow["media_series"]): RelatedSeries | null {
  if (!related) return null;
  return (Array.isArray(related) ? related[0] : related) ?? null;
}

function toMediaItem(row: RecordingRow): MediaItem {
  const series = relatedSeries(row.media_series);

  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    durationSec: row.duration_sec,
    storagePath: row.storage_path,
    visibility: row.visibility === "unlisted" ? "unlisted" : "public",
    seriesId: row.series_id,
    seriesName: series?.name ?? null,
    seriesSlug: series?.slug ?? null,
    tags: {
      speakers: row.speaker_tags ?? [],
      chapters: row.chapter_tags ?? [],
      topics: row.topic_tags ?? [],
    },
    artwork: artworkFromRow(row),
    seriesArtwork: series ? artworkFromRow(series) : EMPTY_ARTWORK,
    legacyPosterUrl: row.mobile_poster_url ?? null,
  };
}

/**
 * Three column sets, newest first, so an unmigrated database degrades instead
 * of failing outright.
 *
 * `MEDIA_COLUMNS` needs migration 0080 (artwork), `MEDIA_COLUMNS_TAGGED` needs
 * 0047 (series, tags, visibility), and `MEDIA_COLUMNS_LEGACY` needs neither.
 * Each fallback loses features rather than breaking the page, which matters
 * because this table is what a church looks at on a Monday morning.
 */
const MEDIA_COLUMNS =
  "id, title, created_at, duration_sec, storage_path, visibility, series_id, speaker_tags, chapter_tags, topic_tags, stream_session_id, mobile_poster_url, artwork_poster_url, artwork_wide_url, artwork_banner_url, media_series(name, slug, artwork_poster_url, artwork_wide_url, artwork_banner_url)";
const MEDIA_COLUMNS_TAGGED =
  "id, title, created_at, duration_sec, storage_path, visibility, series_id, speaker_tags, chapter_tags, topic_tags, stream_session_id, media_series(name)";
const MEDIA_COLUMNS_LEGACY =
  "id, title, created_at, duration_sec, storage_path, stream_session_id";

/** A missing-column error from either of the two migrations above. */
const MISSING_ARTWORK = /artwork_|mobile_poster_url|slug/i;
const MISSING_TAGS = /visibility|series_id|_tags|media_series/i;

/**
 * Runs a select against the richest column set the database supports.
 *
 * The probe order is fixed rather than cached, because the cost of one failed
 * select on a stale database is a single extra round trip, and the cost of
 * caching the answer is a process that keeps serving the degraded shape for its
 * lifetime after a migration lands mid-deploy.
 */
async function selectWithFallback<T>(
  run: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[] | null> {
  let { data, error } = await run(MEDIA_COLUMNS);

  if (error && MISSING_ARTWORK.test(error.message)) {
    ({ data, error } = await run(MEDIA_COLUMNS_TAGGED));
  }
  if (error && MISSING_TAGS.test(error.message)) {
    ({ data, error } = await run(MEDIA_COLUMNS_LEGACY));
  }

  if (error) {
    console.error(`${label}:`, error.message);
    return null;
  }

  return (data ?? []) as T[];
}

export async function listMediaItems(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<MediaItem[]> {
  const db = client(supabase);

  const rows = await selectWithFallback<RecordingRow>(
    (columns) =>
      db
        .from("stream_recordings")
        .select(columns)
        .eq("church_id", churchId)
        .order("created_at", { ascending: false }),
    "listMediaItems",
  );

  return (rows ?? []).map(toMediaItem);
}

export async function getMediaItem(
  churchId: string,
  recordingId: string,
  supabase?: SupabaseClient,
): Promise<MediaItem | null> {
  const db = client(supabase);

  // `maybeSingle` returns an object rather than an array, so it is wrapped to
  // reuse the one fallback ladder instead of repeating it.
  const rows = await selectWithFallback<RecordingRow>(
    async (columns) => {
      const result = await db
        .from("stream_recordings")
        .select(columns)
        .eq("church_id", churchId)
        .eq("id", recordingId)
        .maybeSingle();
      return { data: result.data ? [result.data] : [], error: result.error };
    },
    "getMediaItem",
  );

  const row = rows?.[0];
  return row ? toMediaItem(row) : null;
}

/** The stream session a recording came from, for its live numbers. */
export async function getMediaSessionId(
  churchId: string,
  recordingId: string,
  supabase?: SupabaseClient,
): Promise<string | null> {
  const db = client(supabase);
  const { data } = await db
    .from("stream_recordings")
    .select("stream_session_id")
    .eq("church_id", churchId)
    .eq("id", recordingId)
    .maybeSingle();
  return (data?.stream_session_id as string | null) ?? null;
}

const SERIES_COLUMNS =
  "id, church_id, name, description, slug, artwork_poster_url, artwork_wide_url, artwork_banner_url";
const SERIES_COLUMNS_LEGACY = "id, church_id, name, description";

function toMediaSeries(row: SeriesRow): MediaSeries {
  return {
    id: row.id,
    churchId: row.church_id,
    name: row.name,
    description: row.description,
    slug: row.slug ?? null,
    artwork: artworkFromRow(row),
  };
}

export async function listMediaSeries(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<MediaSeries[]> {
  const db = client(supabase);

  const load = (columns: string) =>
    db
      .from("media_series")
      .select(columns)
      .eq("church_id", churchId)
      .order("name", { ascending: true });

  let { data, error } = await load(SERIES_COLUMNS);
  if (error && MISSING_ARTWORK.test(error.message)) {
    ({ data, error } = await load(SERIES_COLUMNS_LEGACY));
  }

  if (error) {
    if (!/media_series/i.test(error.message)) {
      console.error("listMediaSeries:", error.message);
    }
    return [];
  }

  return ((data ?? []) as unknown as SeriesRow[]).map(toMediaSeries);
}

export async function getMediaSeriesBySlug(
  churchId: string,
  slug: string,
  supabase?: SupabaseClient,
): Promise<MediaSeries | null> {
  const db = client(supabase);
  const { data, error } = await db
    .from("media_series")
    .select(SERIES_COLUMNS)
    .eq("church_id", churchId)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return toMediaSeries(data as unknown as SeriesRow);
}

/**
 * Writes one crop onto a series.
 *
 * Passing null clears it, which is the only way a church can go back to an
 * items-supply-their-own-artwork state after trying a series image.
 */
export async function setMediaSeriesArtwork(
  churchId: string,
  seriesId: string,
  column: `artwork_${"poster" | "wide" | "banner"}_url`,
  url: string | null,
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const db = client(supabase);
  const { error } = await db
    .from("media_series")
    .update({ [column]: url })
    .eq("church_id", churchId)
    .eq("id", seriesId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Clears one crop from every item in a series, so the series image takes over.
 *
 * This is the "apply to all in series" action, and it works by *removing*
 * overrides rather than by copying a URL onto forty rows. Copying would leave
 * forty stale URLs the next time the church changed the series image, and
 * would need a second backfill to undo. Deleting the override lets the
 * inheritance chain in `resolveArtwork` do the work, permanently.
 */
export async function clearSeriesItemArtwork(
  churchId: string,
  seriesId: string,
  column: `artwork_${"poster" | "wide" | "banner"}_url`,
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; error?: string; count: number }> {
  const db = client(supabase);
  const { data, error } = await db
    .from("stream_recordings")
    .update({ [column]: null })
    .eq("church_id", churchId)
    .eq("series_id", seriesId)
    .not(column, "is", null)
    .select("id");

  if (error) return { ok: false, error: error.message, count: 0 };
  return { ok: true, count: (data ?? []).length };
}

/** Finds a series by name for this church, creating it the first time. */
export async function ensureMediaSeries(
  churchId: string,
  name: string,
  supabase?: SupabaseClient,
): Promise<MediaSeries | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const db = client(supabase);
  const existing = await getMediaSeriesByName(db, churchId, trimmed);
  if (existing) return existing;

  const insert = async (payload: Record<string, unknown>, columns: string) =>
    db.from("media_series").insert(payload).select(columns).single();

  // The slug is generated here rather than by a database default, because
  // uniqueness is per church and a default cannot see the church's other rows.
  let { data, error } = await insert(
    { church_id: churchId, name: trimmed, slug: await freeSeriesSlug(db, churchId, trimmed) },
    SERIES_COLUMNS,
  );

  if (error && MISSING_ARTWORK.test(error.message)) {
    ({ data, error } = await insert(
      { church_id: churchId, name: trimmed },
      SERIES_COLUMNS_LEGACY,
    ));
  }

  if (error || !data) {
    console.error("ensureMediaSeries:", error?.message);
    return null;
  }

  return toMediaSeries(data as unknown as SeriesRow);
}

async function getMediaSeriesByName(
  db: SupabaseClient,
  churchId: string,
  name: string,
): Promise<MediaSeries | null> {
  const load = (columns: string) =>
    db
      .from("media_series")
      .select(columns)
      .eq("church_id", churchId)
      .ilike("name", name)
      .maybeSingle();

  let { data, error } = await load(SERIES_COLUMNS);
  if (error && MISSING_ARTWORK.test(error.message)) {
    ({ data, error } = await load(SERIES_COLUMNS_LEGACY));
  }

  if (error || !data) return null;
  return toMediaSeries(data as unknown as SeriesRow);
}

/** Slugifies a series name to match migration 0080's backfill exactly. */
export function slugifySeriesName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "series";
}

/**
 * The first slug for this name that no other series in the church holds.
 *
 * Racing two inserts of the same name can still collide, and the unique index
 * is what actually guarantees correctness. This only keeps the common case from
 * needing the church to see an error.
 */
async function freeSeriesSlug(
  db: SupabaseClient,
  churchId: string,
  name: string,
): Promise<string> {
  const base = slugifySeriesName(name);

  const { data } = await db
    .from("media_series")
    .select("slug")
    .eq("church_id", churchId)
    .like("slug", `${base}%`);

  const taken = new Set(
    ((data ?? []) as Array<{ slug: string | null }>)
      .map((row) => row.slug)
      .filter((slug): slug is string => Boolean(slug)),
  );

  if (!taken.has(base)) return base;

  for (let suffix = 2; suffix < 500; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `${base.slice(0, 60 - suffixText.length - 1)}-${suffixText}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

export async function updateMediaItem(
  churchId: string,
  recordingId: string,
  patch: {
    title?: string;
    visibility?: MediaVisibility;
    seriesId?: string | null;
    speakers?: string[];
    chapters?: string[];
    topics?: string[];
    /** One crop at a time. Null clears the override so the series takes over. */
    artwork?: { column: `artwork_${"poster" | "wide" | "banner"}_url`; url: string | null };
  },
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const updates: Record<string, unknown> = {};
  if (patch.title !== undefined) updates.title = patch.title.trim() || null;
  if (patch.visibility !== undefined) updates.visibility = patch.visibility;
  if (patch.seriesId !== undefined) updates.series_id = patch.seriesId;
  if (patch.speakers !== undefined) updates.speaker_tags = patch.speakers;
  if (patch.chapters !== undefined) updates.chapter_tags = patch.chapters;
  if (patch.topics !== undefined) updates.topic_tags = patch.topics;
  if (patch.artwork !== undefined) updates[patch.artwork.column] = patch.artwork.url;

  if (Object.keys(updates).length === 0) return { ok: true };

  const db = client(supabase);
  const { error } = await db
    .from("stream_recordings")
    .update(updates)
    .eq("church_id", churchId)
    .eq("id", recordingId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Play counts for one recording.
 *
 * Live and replay are reported separately on purpose: a church reads them as
 * two different facts — how many were with us on Sunday, and how many found it
 * afterwards — and one combined number answers neither.
 */
export async function getMediaStats(
  churchId: string,
  recordingId: string,
  sessionId: string | null,
  supabase?: SupabaseClient,
): Promise<MediaStats> {
  const empty: MediaStats = {
    liveViews: 0,
    liveUniqueViewers: 0,
    replayViews: 0,
    replayUniqueViewers: 0,
    replayBySource: { website: 0, app: 0, embed: 0 },
  };

  const db = client(supabase);
  let query = db
    .from("media_views")
    .select("kind, source, viewer_key")
    .eq("church_id", churchId);

  // Live views are recorded against the session (the recording does not exist
  // yet while the service is running), replays against the recording.
  query = sessionId
    ? query.or(`recording_id.eq.${recordingId},stream_session_id.eq.${sessionId}`)
    : query.eq("recording_id", recordingId);

  const { data, error } = await query;

  if (error) {
    if (!/media_views/i.test(error.message)) {
      console.error("getMediaStats:", error.message);
    }
    return empty;
  }

  const rows = (data ?? []) as Array<{
    kind: string;
    source: string;
    viewer_key: string | null;
  }>;

  const liveViewers = new Set<string>();
  const replayViewers = new Set<string>();
  const stats = { ...empty, replayBySource: { ...empty.replayBySource } };

  for (const row of rows) {
    if (row.kind === "live") {
      stats.liveViews += 1;
      if (row.viewer_key) liveViewers.add(row.viewer_key);
    } else {
      stats.replayViews += 1;
      if (row.viewer_key) replayViewers.add(row.viewer_key);
      const source = row.source as MediaViewSource;
      if (source in stats.replayBySource) {
        stats.replayBySource[source] += 1;
      }
    }
  }

  stats.liveUniqueViewers = liveViewers.size;
  stats.replayUniqueViewers = replayViewers.size;
  return stats;
}

/** Records one play. Best effort — analytics must never break playback. */
export async function recordMediaView(
  input: {
    churchId: string;
    recordingId?: string | null;
    streamSessionId?: string | null;
    kind: MediaViewKind;
    source: MediaViewSource;
    viewerKey?: string | null;
  },
  supabase?: SupabaseClient,
): Promise<void> {
  const db = client(supabase);
  if (input.kind === "replay") {
    if (!input.recordingId) throw new Error("Invalid media view relationship.");
    const { data: recording } = await db
      .from("stream_recordings")
      .select("id")
      .eq("id", input.recordingId)
      .eq("church_id", input.churchId)
      .in("visibility", ["public", "unlisted"])
      .maybeSingle();
    if (!recording?.id) throw new Error("Invalid media view relationship.");
  } else {
    if (!input.streamSessionId) throw new Error("Invalid media view relationship.");
    const { data: session } = await db
      .from("stream_sessions")
      .select("id")
      .eq("id", input.streamSessionId)
      .eq("church_id", input.churchId)
      .in("status", ["preparing", "waiting_for_encoder", "live"])
      .maybeSingle();
    if (!session?.id) throw new Error("Invalid media view relationship.");
  }

  const { error } = await db.from("media_views").insert({
    church_id: input.churchId,
    recording_id: input.recordingId ?? null,
    stream_session_id: input.streamSessionId ?? null,
    kind: input.kind,
    source: input.source,
    viewer_key: input.viewerKey ?? null,
    idempotency_key: input.viewerKey
      ? createHash("sha256")
          .update(
            [
              input.churchId,
              input.kind,
              input.source,
              input.recordingId ?? input.streamSessionId,
              input.viewerKey,
            ].join(":"),
          )
          .digest("hex")
      : null,
  });

  if (error && error.code !== "23505" && !/media_views/i.test(error.message)) {
    console.error("[media-view] insert unavailable");
  }
}
