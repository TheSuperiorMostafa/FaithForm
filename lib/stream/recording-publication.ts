import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyRecording } from "@/lib/media/v1/rendition-check";
import { listPosterChoices, type PosterChoice } from "@/lib/media/v1/publication";
import { getRecordingWatchUrl } from "@/lib/site-url";
import { ensureMediaSeries } from "@/lib/stream/media-library";
import {
  MAX_PUBLISHABLE_SECONDS,
  MIN_PUBLISHABLE_SECONDS,
  recordingPhase,
  snapTrim,
  type RecordingPhaseView,
} from "@/lib/stream/recording-model";
import {
  createSupabaseRecordingRepo,
  DEFAULT_RECORDING_SETTINGS,
  type RecordingRecord,
  type RecordingSettings,
} from "@/lib/stream/recording-repo";
import { logRecordingEvent } from "@/lib/stream/recording-lifecycle";
import {
  cancelRecordingNotifications,
  notifyRecordingPublished,
} from "@/lib/stream/recording-notifications";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Publishing a livestream recording — to the Faithful app, the church
 * website, or both — and everything a church does to a recording before and
 * after.
 *
 * The one rule: **nothing reports "Published" until the production read path
 * says so.** After the write, the recording is read back through exactly the
 * projections a phone and the website use. If they do not return it, the
 * church is told publishing did not complete.
 *
 * All callers are server-side, after an admin check; every statement carries
 * the church id so an id from another church matches nothing.
 */

export type AppVisibility = "public" | "followers" | "members";

export const APP_VISIBILITY_LABELS: Record<AppVisibility, string> = {
  public: "Everyone",
  followers: "People who follow your church",
  members: "Members only",
};

function admin(client?: SupabaseClient): SupabaseClient {
  return client ?? createAdminClient();
}

// ---------------------------------------------------------------------------
// What the dashboard shows
// ---------------------------------------------------------------------------

export type StaffRecording = {
  id: string;
  title: string;
  description: string | null;
  speaker: string | null;
  chapters: string[];
  topics: string[];
  seriesId: string | null;
  seriesName: string | null;
  recordedAt: string;
  /** What a viewer will watch, after trimming. */
  durationSec: number | null;
  fullDurationSec: number | null;
  trimStartSec: number;
  trimEndSec: number | null;
  status: RecordingRecord["status"];
  sourceKind: RecordingRecord["sourceKind"];
  phase: RecordingPhaseView;
  posterUrl: string | null;
  autoPosterUrl: string | null;
  chosenPosterUrl: string | null;
  hasCustomArtwork: boolean;
  app: { published: boolean; visibility: AppVisibility | null; publishedAt: string | null };
  website: { published: boolean; publishedAt: string | null; listed: boolean };
  eventId: string | null;
  sessionId: string | null;
  segmentCount: number;
  canPublish: boolean;
  /** Why Publish is unavailable, in plain words. Null when it is available. */
  publishBlockedReason: string | null;
  /** The public page, once the website has it. */
  watchUrl: string | null;
  createdAt: string;
};

const STAFF_COLUMNS =
  "id, church_id, stream_session_id, stream_event_id, title, status, source_kind, storage_path, " +
  "duration_sec, trim_start_sec, trim_end_sec, segment_count, total_bytes, recording_started_at, " +
  "recording_ended_at, last_segment_at, processing_started_at, ready_at, failed_at, failure_reason, " +
  "failure_detail, finalized_by, auto_poster_url, mobile_playable, mobile_rendition_reason, " +
  "mobile_rendition_verified_at, mobile_rendition_revision, mobile_rendition_object_hash, " +
  "mobile_visibility, mobile_published_at, mobile_unpublished_at, mobile_poster_url, mobile_summary, " +
  "web_published_at, web_unpublished_at, series_id, speaker_tags, chapter_tags, topic_tags, deleted_at, " +
  "purged_at, created_at, " +
  "updated_at, visibility, artwork_wide_url, artwork_poster_url, " +
  "media_series(name, artwork_wide_url), stream_events(artwork_url, mobile_poster_url)";

type StaffRow = Record<string, unknown>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toStaffRecording(row: StaffRow, slug: string | null): StaffRecording {
  const series = one(row.media_series as Record<string, unknown> | Record<string, unknown>[] | null);
  const event = one(row.stream_events as Record<string, unknown> | Record<string, unknown>[] | null);
  const mobileVisibility = ((row.mobile_visibility as string) ?? "none") as RecordingRecord["mobileVisibility"];
  const state = {
    status: row.status as RecordingRecord["status"],
    sourceKind: ((row.source_kind as string) ?? "file") as RecordingRecord["sourceKind"],
    mobilePlayable: Boolean(row.mobile_playable),
    renditionReason: (row.mobile_rendition_reason as string | null) ?? null,
    renditionVerifiedAt: (row.mobile_rendition_verified_at as string | null) ?? null,
    mobileVisibility,
    mobilePublishedAt: (row.mobile_published_at as string | null) ?? null,
    mobileUnpublishedAt: (row.mobile_unpublished_at as string | null) ?? null,
    webPublishedAt: (row.web_published_at as string | null) ?? null,
    webUnpublishedAt: (row.web_unpublished_at as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    deletedAt: (row.deleted_at as string | null) ?? null,
  };
  const phase = recordingPhase(state);

  const full = row.duration_sec === null || row.duration_sec === undefined ? null : Number(row.duration_sec);
  const trimStart = Number(row.trim_start_sec ?? 0);
  const trimEnd = row.trim_end_sec === null || row.trim_end_sec === undefined ? null : Number(row.trim_end_sec);
  const duration =
    trimEnd !== null ? Math.max(0, trimEnd - trimStart) : full !== null ? Math.max(0, full - trimStart) : null;

  const appPublished = mobileVisibility !== "none" && Boolean(state.mobilePublishedAt) && !state.mobileUnpublishedAt;
  const webPublished = Boolean(state.webPublishedAt) && !state.webUnpublishedAt;

  const blocked = publishBlockedReason({
    status: state.status,
    playable: state.mobilePlayable,
    duration,
    title: (row.title as string | null) ?? "",
    phase,
  });

  const speakers = (row.speaker_tags as string[] | null) ?? [];
  const customArtwork = (row.artwork_wide_url as string | null) ?? null;

  return {
    id: row.id as string,
    title: ((row.title as string | null) ?? "").trim() || "Service recording",
    description: (row.mobile_summary as string | null) ?? null,
    speaker: speakers[0] ?? null,
    chapters: (row.chapter_tags as string[] | null) ?? [],
    topics: (row.topic_tags as string[] | null) ?? [],
    seriesId: (row.series_id as string | null) ?? null,
    seriesName: (series?.name as string | undefined) ?? null,
    recordedAt: ((row.recording_started_at as string | null) ?? (row.created_at as string)),
    durationSec: duration === null ? null : Math.round(duration),
    fullDurationSec: full === null ? null : Math.round(full),
    trimStartSec: trimStart,
    trimEndSec: trimEnd,
    status: state.status,
    sourceKind: state.sourceKind,
    phase,
    posterUrl:
      customArtwork ??
      ((series?.artwork_wide_url as string | null) ?? null) ??
      ((row.mobile_poster_url as string | null) ?? null) ??
      ((event?.mobile_poster_url as string | null) ?? null) ??
      ((event?.artwork_url as string | null) ?? null) ??
      ((row.auto_poster_url as string | null) ?? null),
    autoPosterUrl: (row.auto_poster_url as string | null) ?? null,
    chosenPosterUrl: (row.mobile_poster_url as string | null) ?? null,
    hasCustomArtwork: Boolean(customArtwork),
    app: {
      published: appPublished,
      visibility: mobileVisibility === "none" ? null : (mobileVisibility as AppVisibility),
      publishedAt: appPublished ? state.mobilePublishedAt : null,
    },
    website: {
      published: webPublished,
      publishedAt: webPublished ? state.webPublishedAt : null,
      listed: (row.visibility as string | null) !== "unlisted",
    },
    eventId: (row.stream_event_id as string | null) ?? null,
    sessionId: (row.stream_session_id as string | null) ?? null,
    segmentCount: Number(row.segment_count ?? 0),
    canPublish: blocked === null,
    publishBlockedReason: blocked,
    watchUrl: webPublished && slug ? getRecordingWatchUrl(slug, row.id as string) : null,
    createdAt: row.created_at as string,
  };
}

function publishBlockedReason(input: {
  status: RecordingRecord["status"];
  playable: boolean;
  duration: number | null;
  title: string;
  phase: RecordingPhaseView;
}): string | null {
  if (input.status === "recording") return "The service is still live. You can publish once it ends.";
  if (input.status === "processing") return "FaithForm is still preparing this recording.";
  if (input.status === "failed" || input.status === "deleted") return input.phase.detail;
  if (!input.playable) return input.phase.detail ?? "FaithForm is still checking this recording.";
  if (!input.title.trim()) return "Give the recording a title first.";
  if (input.duration === null || input.duration < MIN_PUBLISHABLE_SECONDS) {
    return "This recording is too short to publish.";
  }
  if (input.duration > MAX_PUBLISHABLE_SECONDS) {
    return "This recording is over twelve hours long. Trim it before publishing.";
  }
  return null;
}

async function slugFor(db: SupabaseClient, churchId: string): Promise<string | null> {
  const { data } = await db.from("churches").select("slug").eq("id", churchId).maybeSingle();
  return (data?.slug as string | null) ?? null;
}

export async function listStaffRecordings(
  churchId: string,
  options: { limit?: number; client?: SupabaseClient } = {},
): Promise<StaffRecording[]> {
  const db = admin(options.client);
  const [{ data, error }, slug] = await Promise.all([
    db
      .from("stream_recordings")
      .select(STAFF_COLUMNS)
      .eq("church_id", churchId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, options.limit ?? 50))),
    slugFor(db, churchId),
  ]);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StaffRow[]).map((row) => toStaffRecording(row, slug));
}

export async function getStaffRecording(
  churchId: string,
  recordingId: string,
  client?: SupabaseClient,
): Promise<StaffRecording | null> {
  const db = admin(client);
  const [{ data }, slug] = await Promise.all([
    db
      .from("stream_recordings")
      .select(STAFF_COLUMNS)
      .eq("church_id", churchId)
      .eq("id", recordingId)
      .is("deleted_at", null)
      .maybeSingle(),
    slugFor(db, churchId),
  ]);
  return data ? toStaffRecording(data as unknown as StaffRow, slug) : null;
}

/** The recording made from a given broadcast, for the post-live screen. */
export async function getStaffRecordingForSession(
  churchId: string,
  sessionId: string,
  client?: SupabaseClient,
): Promise<StaffRecording | null> {
  const db = admin(client);
  const [{ data }, slug] = await Promise.all([
    db
      .from("stream_recordings")
      .select(STAFF_COLUMNS)
      .eq("church_id", churchId)
      .eq("stream_session_id", sessionId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    slugFor(db, churchId),
  ]);
  return data ? toStaffRecording(data as unknown as StaffRow, slug) : null;
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

export type ThumbnailChoice = PosterChoice & { kind: "frame" | "artwork" };

/**
 * What a church may choose as a thumbnail: frames captured from this very
 * recording, the service's artwork, and the church's own images. Nothing
 * else — a thumbnail field that accepted any URL would put arbitrary images
 * on every member's phone.
 */
export async function listThumbnailChoices(
  churchId: string,
  recordingId: string,
  client?: SupabaseClient,
): Promise<ThumbnailChoice[]> {
  const db = admin(client);
  const { data: recording } = await db
    .from("stream_recordings")
    .select("stream_event_id, auto_poster_url")
    .eq("id", recordingId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!recording) return [];

  const repo = createSupabaseRecordingRepo(db);
  const frames = await repo.listFrames(recordingId);
  const framePicks = frames.length > 8
    ? Array.from({ length: 8 }, (_, index) => frames[Math.floor((index * (frames.length - 1)) / 7)])
    : frames;

  const choices: ThumbnailChoice[] = framePicks.map((frame, index) => ({
    url: frame.publicUrl,
    label: `Frame ${index + 1}`,
    source: "frame",
    kind: "frame" as const,
  }));
  const auto = (recording.auto_poster_url as string | null) ?? null;
  if (auto && !choices.some((choice) => choice.url === auto)) {
    choices.unshift({ url: auto, label: "Automatic", source: "frame", kind: "frame" });
  }
  const artwork = await listPosterChoices(churchId, {
    streamEventId: (recording.stream_event_id as string | null) ?? null,
    supabase: db,
  });
  return [...choices, ...artwork.map((choice) => ({ ...choice, kind: "artwork" as const }))];
}

export async function chooseThumbnail(
  input: { churchId: string; recordingId: string; url: string | null },
  client?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const db = admin(client);
  if (input.url) {
    const allowed = await listThumbnailChoices(input.churchId, input.recordingId, db);
    if (!allowed.some((choice) => choice.url === input.url)) {
      return { ok: false, error: "Choose one of the pictures shown." };
    }
  }
  const { error } = await db
    .from("stream_recordings")
    .update({ mobile_poster_url: input.url })
    .eq("id", input.recordingId)
    .eq("church_id", input.churchId);
  return error ? { ok: false, error: "Could not save the thumbnail." } : { ok: true };
}

// ---------------------------------------------------------------------------
// Details and trim
// ---------------------------------------------------------------------------

export async function updateRecordingDetails(
  input: {
    churchId: string;
    recordingId: string;
    title?: string;
    description?: string | null;
    speaker?: string | null;
    seriesId?: string | null;
    newSeriesName?: string | null;
    listedOnWebsite?: boolean;
    chapters?: string[];
    topics?: string[];
  },
  client?: SupabaseClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = admin(client);
  const updates: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { ok: false, error: "A recording needs a title." };
    updates.title = title.slice(0, 200);
  }
  if (input.description !== undefined) {
    updates.mobile_summary = input.description?.trim() ? input.description.trim().slice(0, 2000) : null;
  }
  if (input.speaker !== undefined) {
    const { data: current } = await db
      .from("stream_recordings")
      .select("speaker_tags")
      .eq("id", input.recordingId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    const rest = ((current?.speaker_tags as string[] | null) ?? []).slice(1);
    const speaker = input.speaker?.trim().slice(0, 120) ?? "";
    updates.speaker_tags = speaker ? [speaker, ...rest.filter((name) => name !== speaker)] : rest;
  }
  if (input.newSeriesName?.trim()) {
    const series = await ensureMediaSeries(input.churchId, input.newSeriesName, db);
    if (!series) return { ok: false, error: "Could not create that series." };
    updates.series_id = series.id;
  } else if (input.seriesId !== undefined) {
    if (input.seriesId) {
      const { data: series } = await db
        .from("media_series")
        .select("id")
        .eq("id", input.seriesId)
        .eq("church_id", input.churchId)
        .maybeSingle();
      if (!series) return { ok: false, error: "That series is no longer available." };
    }
    updates.series_id = input.seriesId;
  }
  if (input.listedOnWebsite !== undefined) {
    updates.visibility = input.listedOnWebsite ? "public" : "unlisted";
  }
  const cleanTags = (values: string[]) =>
    Array.from(new Set(values.map((value) => value.trim().slice(0, 80)).filter(Boolean))).slice(0, 20);
  if (input.chapters !== undefined) updates.chapter_tags = cleanTags(input.chapters);
  if (input.topics !== undefined) updates.topic_tags = cleanTags(input.topics);

  if (Object.keys(updates).length === 0) return { ok: true };
  const { data, error } = await db
    .from("stream_recordings")
    .update(updates)
    .eq("id", input.recordingId)
    .eq("church_id", input.churchId)
    .is("deleted_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Could not save those details." };
  return { ok: true };
}

/**
 * Trims the beginning and end. Snapped outward to segment boundaries, so what
 * the church asked to keep is always kept; the snapped values are returned so
 * the page can show exactly where it now starts and ends.
 */
export async function trimRecording(
  input: { churchId: string; recordingId: string; startSec: number; endSec: number | null },
  client?: SupabaseClient,
): Promise<{ ok: true; startSec: number; endSec: number | null; durationSec: number } | { ok: false; error: string }> {
  const db = admin(client);
  const repo = createSupabaseRecordingRepo(db);
  const recording = await repo.getRecording(input.churchId, input.recordingId);
  if (!recording || recording.deletedAt) return { ok: false, error: "That recording is no longer available." };
  if (recording.status !== "ready") return { ok: false, error: "You can trim once the recording is ready." };
  if (!Number.isFinite(input.startSec) || input.startSec < 0) return { ok: false, error: "Choose a start time." };
  if (input.endSec !== null && (!Number.isFinite(input.endSec) || input.endSec <= input.startSec)) {
    return { ok: false, error: "The end has to come after the start." };
  }

  let startSec = input.startSec;
  let endSec = input.endSec;
  let durationSec: number;

  if (recording.sourceKind === "segments") {
    const segments = (await repo.listSegments(recording.id)).filter((segment) => segment.status === "uploaded");
    const snapped = snapTrim(segments, input.startSec, input.endSec);
    startSec = snapped.startSec;
    endSec = snapped.endSec;
    durationSec = snapped.durationSec;
  } else {
    const full = recording.durationSec ?? 0;
    endSec = endSec !== null && endSec >= full ? null : endSec;
    durationSec = (endSec ?? full) - startSec;
  }

  if (durationSec < MIN_PUBLISHABLE_SECONDS) {
    return { ok: false, error: "That would leave less than five seconds." };
  }

  await repo.updateRecording(input.churchId, input.recordingId, { trimStartSec: startSec, trimEndSec: endSec });
  logRecordingEvent("recording_trimmed", { churchId: input.churchId, recordingId: input.recordingId });
  return { ok: true, startSec, endSec, durationSec };
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export type PublishRequest = {
  churchId: string;
  recordingId: string;
  actorUserId: string | null;
  via: "staff" | "automatic";
  /** Null leaves the app as it is (for a website-only publish). */
  appVisibility: AppVisibility | null;
  website: boolean;
  notifyMembers: boolean;
};

export type PublishResult =
  | {
      ok: true;
      changed: boolean;
      app: boolean;
      website: boolean;
      recording: StaffRecording | null;
    }
  | { ok: false; reason: string; message: string };

const REFUSAL_MESSAGES: Record<string, string> = {
  not_found: "That recording is no longer available.",
  not_ready: "FaithForm is still preparing this recording. It will be ready to publish shortly.",
  title_missing: "Give the recording a title first.",
  duration_invalid: "This recording is too short, or too long, to publish. Check the trim.",
  verification_stale: "FaithForm re-checked this recording while you were publishing. Please try again.",
  no_destination: "Choose where to publish it.",
  invalid_visibility: "Choose who can see it.",
  not_confirmed:
    "FaithForm saved your choice but couldn't confirm the recording is showing yet. Nothing is published until it can — please try again in a minute.",
  unavailable: "Could not publish right now. Please try again.",
};

/**
 * Confirms, through the exact read path a phone and the website use, that the
 * recording is actually visible and playable. `joined` is used for the app
 * check because it is the most permissive relationship: if a member cannot
 * see it, nobody can.
 */
export async function confirmPublication(
  input: { churchId: string; recordingId: string; app: boolean; website: boolean },
  client?: SupabaseClient,
): Promise<{ app: boolean; website: boolean }> {
  const db = admin(client);
  const slug = await slugFor(db, input.churchId);
  if (!slug) return { app: false, website: false };

  let app = false;
  if (input.app) {
    const [{ data: detail }, { data: grant }] = await Promise.all([
      db.rpc("mobile_media_detail", {
        p_church_slug: slug,
        p_relationship_state: "joined",
        p_recording_id: input.recordingId,
      }),
      db.rpc("mobile_media_playback_grant", {
        p_church_slug: slug,
        p_relationship_state: "joined",
        p_kind: "recording",
        p_media_id: input.recordingId,
      }),
    ]);
    app =
      ((detail ?? []) as unknown[]).length > 0 &&
      Boolean(((grant ?? []) as Array<Record<string, unknown>>)[0]?.ok);
  }

  let website = false;
  if (input.website) {
    const { data } = await db.rpc("web_recordings", {
      p_church_slug: slug,
      p_recording_id: input.recordingId,
      p_limit: 1,
    });
    website = ((data ?? []) as unknown[]).length > 0;
  }
  return { app, website };
}

/**
 * Publishes a recording. Idempotent: the SQL function locks the row and
 * reports "unchanged" for a repeat, so double clicks, retries and two staff
 * members publish once.
 */
export async function publishRecording(
  request: PublishRequest,
  client?: SupabaseClient,
): Promise<PublishResult> {
  const db = admin(client);
  const repo = createSupabaseRecordingRepo(db);
  const recording = await repo.getRecording(request.churchId, request.recordingId);
  if (!recording || recording.deletedAt) {
    return { ok: false, reason: "not_found", message: REFUSAL_MESSAGES.not_found };
  }

  logRecordingEvent("publish_started", {
    churchId: request.churchId,
    recordingId: request.recordingId,
    via: request.via,
  });

  // The verdict this publish is bound to. A segmented recording was verified
  // by the lifecycle when it became ready; a legacy file is re-probed now, as
  // it always was.
  let revision = recording.renditionRevision;
  let objectHash = recording.renditionObjectHash;
  if (recording.sourceKind === "file" && recording.status === "ready") {
    const rendition = await verifyRecording(
      { recordingId: recording.id, churchId: recording.churchId, storagePath: recording.storagePath },
      db,
    );
    revision = rendition.revision;
    objectHash = rendition.identity.windowHash;
  }

  // Poster: the church's explicit choice, else the automatic frame.
  const poster = recording.mobilePosterUrl ?? recording.autoPosterUrl ?? null;

  const { data, error } = await db.rpc("publish_recording", {
    p_recording_id: recording.id,
    p_church_id: recording.churchId,
    p_app_visibility: request.appVisibility,
    p_publish_to_web: request.website,
    p_poster_url: poster,
    p_summary: recording.mobileSummary,
    p_expected_revision: revision,
    p_expected_object_hash: objectHash,
    p_actor_user_id: request.actorUserId,
    p_via: request.via,
  });

  if (error) {
    logRecordingEvent("publish_failed", { churchId: request.churchId, recordingId: recording.id, reason: "rpc_error" });
    return { ok: false, reason: "unavailable", message: REFUSAL_MESSAGES.unavailable };
  }
  const outcome = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (!outcome?.ok) {
    const reason = (outcome?.reason as string) ?? "unavailable";
    logRecordingEvent("publish_failed", { churchId: request.churchId, recordingId: recording.id, reason });
    const message =
      REFUSAL_MESSAGES[reason] ??
      recordingPhase({
        status: recording.status,
        sourceKind: recording.sourceKind,
        mobilePlayable: false,
        renditionReason: reason,
        renditionVerifiedAt: recording.renditionVerifiedAt,
        mobileVisibility: recording.mobileVisibility,
        mobilePublishedAt: null,
        mobileUnpublishedAt: null,
        webPublishedAt: null,
        webUnpublishedAt: null,
        failureReason: recording.failureReason,
        deletedAt: null,
      }).detail ??
      REFUSAL_MESSAGES.unavailable;
    return { ok: false, reason, message };
  }

  const confirmed = await confirmPublication(
    {
      churchId: request.churchId,
      recordingId: recording.id,
      app: request.appVisibility !== null,
      website: request.website,
    },
    db,
  );
  const wantedApp = request.appVisibility !== null;
  if ((wantedApp && !confirmed.app) || (request.website && !confirmed.website)) {
    logRecordingEvent("publish_failed", {
      churchId: request.churchId,
      recordingId: recording.id,
      reason: "not_confirmed",
      app: confirmed.app,
      website: confirmed.website,
    });
    return { ok: false, reason: "not_confirmed", message: REFUSAL_MESSAGES.not_confirmed };
  }

  await db
    .from("stream_recordings")
    .update({ publish_confirmed_at: new Date().toISOString() })
    .eq("id", recording.id)
    .eq("church_id", request.churchId);

  const firstAppPublication = wantedApp && !recording.mobilePublishedAt;
  if (firstAppPublication && request.notifyMembers) {
    await notifyRecordingPublished({ churchId: request.churchId, recordingId: recording.id }, db).catch(
      () => false,
    );
  }

  logRecordingEvent("publish_succeeded", {
    churchId: request.churchId,
    recordingId: recording.id,
    via: request.via,
    changed: Boolean(outcome.changed),
    app: confirmed.app,
    website: confirmed.website,
  });

  return {
    ok: true,
    changed: Boolean(outcome.changed),
    app: confirmed.app,
    website: confirmed.website,
    recording: await getStaffRecording(request.churchId, recording.id, db),
  };
}

export async function unpublishRecording(
  input: { churchId: string; recordingId: string; actorUserId: string },
  client?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const db = admin(client);
  const { data, error } = await db.rpc("unpublish_recording", {
    p_recording_id: input.recordingId,
    p_church_id: input.churchId,
    p_actor_user_id: input.actorUserId,
    p_revoke: false,
  });
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (error || !row?.ok) return { ok: false, error: "Could not unpublish that recording." };
  await cancelRecordingNotifications(input.recordingId, db);
  logRecordingEvent("recording_unpublished", { churchId: input.churchId, recordingId: input.recordingId });
  return { ok: true };
}

/**
 * Deletes permanently: withdrawn everywhere at once, and its video removed
 * from storage. The row stays so the church's history still says it existed.
 */
export async function deleteRecordingPermanently(
  input: { churchId: string; recordingId: string; actorUserId: string },
  client?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const db = admin(client);
  const { data, error } = await db.rpc("delete_recording", {
    p_recording_id: input.recordingId,
    p_church_id: input.churchId,
    p_actor_user_id: input.actorUserId,
  });
  const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
  if (error || !row?.ok) return { ok: false, error: "Could not delete that recording." };
  await cancelRecordingNotifications(input.recordingId, db);
  logRecordingEvent("recording_deleted", { churchId: input.churchId, recordingId: input.recordingId });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings and auto-publish
// ---------------------------------------------------------------------------

export async function getRecordingSettings(
  churchId: string,
  client?: SupabaseClient,
): Promise<RecordingSettings> {
  return createSupabaseRecordingRepo(admin(client)).getSettings(churchId);
}

export async function saveRecordingSettings(
  input: { churchId: string; userId: string; settings: RecordingSettings },
  client?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const db = admin(client);
  const settings = { ...DEFAULT_RECORDING_SETTINGS, ...input.settings };
  if (settings.defaultSeriesId) {
    const { data } = await db
      .from("media_series")
      .select("id")
      .eq("id", settings.defaultSeriesId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    if (!data) return { ok: false, error: "That series is no longer available." };
  }
  const { error } = await db.from("stream_recording_settings").upsert(
    {
      church_id: input.churchId,
      auto_publish: settings.autoPublish,
      default_visibility: settings.defaultVisibility,
      default_series_id: settings.defaultSeriesId,
      publish_to_website: settings.publishToWebsite,
      notify_on_live: settings.notifyOnLive,
      notify_on_publish: settings.notifyOnPublish,
      updated_by: input.userId,
    },
    { onConflict: "church_id" },
  );
  return error ? { ok: false, error: "Could not save those settings." } : { ok: true };
}

/**
 * Publishes a newly ready recording when the church asked for that.
 *
 * Only a recording nobody has made a decision about: one a staff member
 * already published, or took down, is theirs. Incomplete metadata gets the
 * church's defaults, never a silent failure — a refusal is logged and the
 * recording stays "Ready to publish" on the dashboard.
 */
export async function autoPublishRecording(
  recording: RecordingRecord,
  client?: SupabaseClient,
): Promise<PublishResult | null> {
  const db = admin(client);
  const settings = await getRecordingSettings(recording.churchId, db);
  if (!settings.autoPublish) return null;
  if (recording.mobilePublishedAt || recording.webPublishedAt) return null;
  if (recording.mobileUnpublishedAt || recording.webUnpublishedAt) return null;

  if (!recording.seriesId && settings.defaultSeriesId) {
    await db
      .from("stream_recordings")
      .update({ series_id: settings.defaultSeriesId })
      .eq("id", recording.id)
      .eq("church_id", recording.churchId)
      .is("series_id", null);
  }

  const result = await publishRecording(
    {
      churchId: recording.churchId,
      recordingId: recording.id,
      actorUserId: null,
      via: "automatic",
      appVisibility: settings.defaultVisibility,
      website: settings.publishToWebsite,
      notifyMembers: settings.notifyOnPublish,
    },
    db,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Staff playback
// ---------------------------------------------------------------------------

/**
 * A player source for the review screen. A segmented recording plays through
 * the staff route with a signed staff token; a legacy file through a signed
 * storage URL, as the dashboard always has. Never handed to a visitor.
 */
export async function getStaffPlayback(
  churchId: string,
  recordingId: string,
  client?: SupabaseClient,
): Promise<{ kind: "hls" | "progressive"; url: string } | null> {
  const db = admin(client);
  const { data } = await db
    .from("stream_recordings")
    .select("source_kind, storage_path, segment_count, deleted_at")
    .eq("id", recordingId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!data || data.deleted_at) return null;

  if (data.source_kind === "segments") {
    if (Number(data.segment_count ?? 0) === 0) return null;
    const { signRecordingPlaybackToken, recordingPlaylistPath } = await import(
      "@/lib/stream/recording-playback"
    );
    const token = signRecordingPlaybackToken({ churchId, recordingId, audience: "staff" });
    return token ? { kind: "hls", url: recordingPlaylistPath(recordingId, token) } : null;
  }

  const { data: signed } = await db.storage
    .from("stream-recordings")
    .createSignedUrl(data.storage_path as string, 60 * 60 * 4);
  return signed?.signedUrl ? { kind: "progressive", url: signed.signedUrl } : null;
}
