import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type StreamEventStatus = "scheduled" | "live" | "ended" | "cancelled";

export type StreamEvent = {
  id: string;
  churchId: string;
  title: string;
  startsAt: string;
  recurrenceRule: string | null;
  recurrenceGroupId?: string | null;
  recordingAppVisibility?: "none" | "public" | "followers" | "members" | null;
  recordingPublishToWebsite?: boolean | null;
  recordingNotifyMembers?: boolean | null;
  status: StreamEventStatus;
  syndicateYoutube: boolean;
  syndicateFacebook: boolean;
  youtubePrivacy: "public" | "unlisted" | "private";
  artworkUrl: string | null;
  speaker?: string | null;
  description?: string | null;
  chapters?: string[];
  topics?: string[];
  seriesId?: string | null;
  artworkPosterUrl?: string | null;
  artworkWideUrl?: string | null;
  artworkBannerUrl?: string | null;
  chatEnabled: boolean;
  countdownEnabled: boolean;
  publicAccess: boolean;
  simulated: boolean;
  simulatedSourcePath: string | null;
  streamSessionId: string | null;
  syndicationRetryUntil: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type EventRow = {
  id: string;
  church_id: string;
  title: string;
  starts_at: string;
  recurrence_rule: string | null;
  recurrence_group_id?: string | null;
  recording_app_visibility?: "none" | "public" | "followers" | "members" | null;
  recording_publish_to_website?: boolean | null;
  recording_notify_members?: boolean | null;
  status: StreamEventStatus;
  syndicate_youtube: boolean;
  syndicate_facebook: boolean;
  youtube_privacy: "public" | "unlisted" | "private";
  artwork_url: string | null;
  speaker_tags?: string[] | null;
  description?: string | null;
  chapter_tags?: string[] | null;
  topic_tags?: string[] | null;
  series_id?: string | null;
  artwork_poster_url?: string | null;
  artwork_wide_url?: string | null;
  artwork_banner_url?: string | null;
  chat_enabled: boolean;
  countdown_enabled: boolean;
  public_access?: boolean;
  simulated: boolean;
  simulated_source_path: string | null;
  stream_session_id: string | null;
  syndication_retry_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function mapEvent(row: EventRow): StreamEvent {
  return {
    id: row.id,
    churchId: row.church_id,
    title: row.title,
    startsAt: row.starts_at,
    recurrenceRule: row.recurrence_rule,
    recurrenceGroupId: row.recurrence_group_id ?? null,
    recordingAppVisibility: row.recording_app_visibility ?? null,
    recordingPublishToWebsite: row.recording_publish_to_website ?? null,
    recordingNotifyMembers: row.recording_notify_members ?? null,
    status: row.status,
    syndicateYoutube: row.syndicate_youtube,
    syndicateFacebook: row.syndicate_facebook,
    youtubePrivacy: row.youtube_privacy,
    artworkUrl: row.artwork_url,
    speaker: row.speaker_tags?.[0] ?? null,
    description: row.description ?? null,
    chapters: row.chapter_tags ?? [],
    topics: row.topic_tags ?? [],
    seriesId: row.series_id ?? null,
    artworkPosterUrl: row.artwork_poster_url ?? null,
    artworkWideUrl: row.artwork_wide_url ?? null,
    artworkBannerUrl: row.artwork_banner_url ?? null,
    chatEnabled: row.chat_enabled,
    countdownEnabled: row.countdown_enabled,
    publicAccess: row.public_access !== false,
    simulated: row.simulated,
    simulatedSourcePath: row.simulated_source_path,
    streamSessionId: row.stream_session_id,
    syndicationRetryUntil: row.syndication_retry_until,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

export async function listStreamEvents(
  churchId: string,
  options?: { limit?: number; supabase?: SupabaseClient; statuses?: StreamEventStatus[]; ascending?: boolean },
): Promise<StreamEvent[]> {
  const client = getClient(options?.supabase);
  let query = client.from("stream_events").select("*").eq("church_id", churchId);
  if (options?.statuses) query = query.in("status", options.statuses);
  const { data, error } = await query
    .order("starts_at", { ascending: options?.ascending ?? false })
    .limit(options?.limit ?? 20);

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapEvent(row as EventRow));
}

export async function getStreamEvent(
  eventId: string,
  supabase?: SupabaseClient,
): Promise<StreamEvent | null> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapEvent(data as EventRow) : null;
}

export async function getUpcomingStreamEvent(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamEvent | null> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_events")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "scheduled")
    .gte("starts_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return mapEvent(data as EventRow);

  const { data: live } = await client
    .from("stream_events")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "live")
    .limit(1)
    .maybeSingle();

  return live ? mapEvent(live as EventRow) : null;
}

export async function getPublicStreamEventByChurchId(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamEvent | null> {
  const client = getClient(supabase);
  const { data: live } = await client
    .from("stream_events")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "live")
    .eq("public_access", true)
    .limit(1)
    .maybeSingle();

  if (live) return mapEvent(live as EventRow);

  const { data: upcoming } = await client
    .from("stream_events")
    .select("*")
    .eq("church_id", churchId)
    .eq("status", "scheduled")
    .eq("public_access", true)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return upcoming ? mapEvent(upcoming as EventRow) : null;
}

export async function createStreamEvent(
  input: {
    churchId: string;
    title: string;
    startsAt: string;
    speaker?: string | null;
    description?: string | null;
    chapters?: string[];
    topics?: string[];
    seriesId?: string | null;
    artworkUrl?: string | null;
    artworkPosterUrl?: string | null;
    artworkWideUrl?: string | null;
    artworkBannerUrl?: string | null;
    recurrenceRule?: string | null;
    recurrenceTimeZone?: string;
    recordingAppVisibility?: "none" | "public" | "followers" | "members" | null;
    recordingPublishToWebsite?: boolean | null;
    recordingNotifyMembers?: boolean | null;
    syndicateYoutube?: boolean;
    syndicateFacebook?: boolean;
    youtubePrivacy?: "public" | "unlisted" | "private";
    chatEnabled?: boolean;
    countdownEnabled?: boolean;
    publicAccess?: boolean;
    simulated?: boolean;
    simulatedSourcePath?: string | null;
    createdBy: string | null;
  },
  supabase?: SupabaseClient,
): Promise<StreamEvent> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_events")
    .insert({
      church_id: input.churchId,
      title: input.title.trim(),
      starts_at: input.startsAt,
      speaker_tags: input.speaker ? [input.speaker] : [],
      description: input.description ?? null,
      chapter_tags: input.chapters ?? [],
      topic_tags: input.topics ?? [],
      series_id: input.seriesId ?? null,
      artwork_url: input.artworkUrl ?? null,
      artwork_poster_url: input.artworkPosterUrl ?? null,
      artwork_wide_url: input.artworkWideUrl ?? null,
      artwork_banner_url: input.artworkBannerUrl ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      recurrence_time_zone: input.recurrenceTimeZone ?? null,
      recording_app_visibility: input.recordingAppVisibility ?? null,
      recording_publish_to_website: input.recordingPublishToWebsite ?? null,
      recording_notify_members: input.recordingNotifyMembers ?? null,
      syndicate_youtube: input.syndicateYoutube ?? true,
      syndicate_facebook: input.syndicateFacebook ?? true,
      youtube_privacy: input.youtubePrivacy ?? "public",
      chat_enabled: input.chatEnabled ?? false,
      countdown_enabled: input.countdownEnabled ?? true,
      public_access: input.publicAccess ?? true,
      simulated: input.simulated ?? false,
      simulated_source_path: input.simulatedSourcePath ?? null,
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create stream event.");
  }

  return mapEvent(data as EventRow);
}

export async function updateStreamEvent(
  eventId: string,
  churchId: string,
  patch: Partial<{
    status: StreamEventStatus;
    streamSessionId: string | null;
    syndicationRetryUntil: string | null;
    title: string;
    startsAt: string;
    publicAccess: boolean;
    recordingAppVisibility: "none" | "public" | "followers" | "members" | null;
    recordingPublishToWebsite: boolean | null;
    recordingNotifyMembers: boolean | null;
    speaker: string | null;
    description: string | null;
    chapters: string[];
    topics: string[];
    seriesId: string | null;
    artworkUrl: string | null;
    artworkPosterUrl: string | null;
    artworkWideUrl: string | null;
    artworkBannerUrl: string | null;
  }>,
  supabase?: SupabaseClient,
  requiredStatus?: StreamEventStatus,
): Promise<StreamEvent> {
  const client = getClient(supabase);
  const updates: Record<string, unknown> = {};
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.streamSessionId !== undefined) {
    updates.stream_session_id = patch.streamSessionId;
  }
  if (patch.syndicationRetryUntil !== undefined) {
    updates.syndication_retry_until = patch.syndicationRetryUntil;
  }
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.publicAccess !== undefined) updates.public_access = patch.publicAccess;
  if (patch.recordingAppVisibility !== undefined) updates.recording_app_visibility = patch.recordingAppVisibility;
  if (patch.recordingPublishToWebsite !== undefined) updates.recording_publish_to_website = patch.recordingPublishToWebsite;
  if (patch.recordingNotifyMembers !== undefined) updates.recording_notify_members = patch.recordingNotifyMembers;
  if (patch.startsAt !== undefined) updates.starts_at = patch.startsAt;

  if (patch.speaker !== undefined) updates.speaker_tags = patch.speaker ? [patch.speaker] : [];
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.chapters !== undefined) updates.chapter_tags = patch.chapters;
  if (patch.topics !== undefined) updates.topic_tags = patch.topics;
  if (patch.seriesId !== undefined) updates.series_id = patch.seriesId;
  if (patch.artworkUrl !== undefined) updates.artwork_url = patch.artworkUrl;
  if (patch.artworkPosterUrl !== undefined) updates.artwork_poster_url = patch.artworkPosterUrl;
  if (patch.artworkWideUrl !== undefined) updates.artwork_wide_url = patch.artworkWideUrl;
  if (patch.artworkBannerUrl !== undefined) updates.artwork_banner_url = patch.artworkBannerUrl;

  let query = client.from("stream_events").update(updates)
    .eq("id", eventId).eq("church_id", churchId);
  if (requiredStatus) query = query.eq("status", requiredStatus);
  const { data, error } = await query
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update stream event.");
  }

  return mapEvent(data as EventRow);
}

export async function cancelStreamEvent(
  eventId: string,
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamEvent> {
  return updateStreamEvent(eventId, churchId, { status: "cancelled" }, supabase, "scheduled");
}

export function nextWeeklyOccurrence(
  startsAt: string,
  recurrenceRule: string | null,
): string | null {
  if (!recurrenceRule || recurrenceRule !== "weekly") return null;
  const next = new Date(startsAt);
  next.setDate(next.getDate() + 7);
  return next.toISOString();
}
