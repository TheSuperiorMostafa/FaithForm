import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type MediaVisibility = "public" | "unlisted";
export type MediaViewKind = "live" | "replay";
export type MediaViewSource = "website" | "app" | "embed";

export type MediaSeries = {
  id: string;
  churchId: string;
  name: string;
  description: string | null;
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
  tags: MediaTags;
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

type SeriesRow = {
  id: string;
  church_id: string;
  name: string;
  description: string | null;
};

type RecordingRow = {
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
  media_series?: { name?: string } | { name?: string }[] | null;
};

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

function seriesName(related: RecordingRow["media_series"]): string | null {
  if (!related) return null;
  const row = Array.isArray(related) ? related[0] : related;
  return row?.name ?? null;
}

function toMediaItem(row: RecordingRow): MediaItem {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    durationSec: row.duration_sec,
    storagePath: row.storage_path,
    visibility: row.visibility === "unlisted" ? "unlisted" : "public",
    seriesId: row.series_id,
    seriesName: seriesName(row.media_series),
    tags: {
      speakers: row.speaker_tags ?? [],
      chapters: row.chapter_tags ?? [],
      topics: row.topic_tags ?? [],
    },
  };
}

/**
 * The columns added in migration 0047. Selected separately so an unmigrated
 * database can fall back to the original shape rather than failing outright.
 */
const MEDIA_COLUMNS =
  "id, title, created_at, duration_sec, storage_path, visibility, series_id, speaker_tags, chapter_tags, topic_tags, stream_session_id, media_series(name)";
const MEDIA_COLUMNS_LEGACY =
  "id, title, created_at, duration_sec, storage_path, stream_session_id";

export async function listMediaItems(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<MediaItem[]> {
  const db = client(supabase);

  const load = (columns: string) =>
    db
      .from("stream_recordings")
      .select(columns)
      .eq("church_id", churchId)
      .order("created_at", { ascending: false });

  let { data, error } = await load(MEDIA_COLUMNS);
  if (error && /visibility|series_id|_tags|media_series/i.test(error.message)) {
    ({ data, error } = await load(MEDIA_COLUMNS_LEGACY));
  }

  if (error) {
    console.error("listMediaItems:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as RecordingRow[]).map(toMediaItem);
}

export async function getMediaItem(
  churchId: string,
  recordingId: string,
  supabase?: SupabaseClient,
): Promise<MediaItem | null> {
  const db = client(supabase);

  const load = (columns: string) =>
    db
      .from("stream_recordings")
      .select(columns)
      .eq("church_id", churchId)
      .eq("id", recordingId)
      .maybeSingle();

  let { data, error } = await load(MEDIA_COLUMNS);
  if (error && /visibility|series_id|_tags|media_series/i.test(error.message)) {
    ({ data, error } = await load(MEDIA_COLUMNS_LEGACY));
  }

  if (error || !data) return null;
  return toMediaItem(data as unknown as RecordingRow);
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

export async function listMediaSeries(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<MediaSeries[]> {
  const db = client(supabase);
  const { data, error } = await db
    .from("media_series")
    .select("id, church_id, name, description")
    .eq("church_id", churchId)
    .order("name", { ascending: true });

  if (error) {
    if (!/media_series/i.test(error.message)) {
      console.error("listMediaSeries:", error.message);
    }
    return [];
  }

  return ((data ?? []) as SeriesRow[]).map((row) => ({
    id: row.id,
    churchId: row.church_id,
    name: row.name,
    description: row.description,
  }));
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
  const { data: existing } = await db
    .from("media_series")
    .select("id, church_id, name, description")
    .eq("church_id", churchId)
    .ilike("name", trimmed)
    .maybeSingle();

  if (existing) {
    const row = existing as SeriesRow;
    return {
      id: row.id,
      churchId: row.church_id,
      name: row.name,
      description: row.description,
    };
  }

  const { data, error } = await db
    .from("media_series")
    .insert({ church_id: churchId, name: trimmed })
    .select("id, church_id, name, description")
    .single();

  if (error || !data) {
    console.error("ensureMediaSeries:", error?.message);
    return null;
  }

  const row = data as SeriesRow;
  return {
    id: row.id,
    churchId: row.church_id,
    name: row.name,
    description: row.description,
  };
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
  const { error } = await db.from("media_views").insert({
    church_id: input.churchId,
    recording_id: input.recordingId ?? null,
    stream_session_id: input.streamSessionId ?? null,
    kind: input.kind,
    source: input.source,
    viewer_key: input.viewerKey ?? null,
  });

  if (error && !/media_views/i.test(error.message)) {
    console.error("recordMediaView:", error.message);
  }
}
