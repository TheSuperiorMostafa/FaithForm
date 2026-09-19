import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Member notifications for livestreams, through the existing outbox.
 *
 * Two notifications exist, both off until a church turns them on in Stream
 * setup:
 *
 *   * "Sunday Worship is live now" — once per broadcast, when video is actually
 *     arriving (not when a button was pressed on an empty stream);
 *   * "Sunday Worship is now available to watch" — once per recording, on its
 *     first publication to the app.
 *
 * "Recording ready" is an administrative state and is never sent to a
 * congregation. Both ride the existing `events` topic, so a member who has
 * turned events off hears nothing, and the worker re-checks the subject before
 * sending — a service that ended, or a recording unpublished in the meantime,
 * is cancelled rather than announced.
 */

const TOPIC = "events";

function dedupeKey(kind: string, id: string): string {
  return createHash("sha256").update(`${kind}:${id}`, "utf8").digest("hex").slice(0, 40);
}

async function churchSlug(db: SupabaseClient, churchId: string): Promise<string | null> {
  const { data } = await db.from("churches").select("slug").eq("id", churchId).maybeSingle();
  return (data?.slug as string | null) ?? null;
}

async function enqueue(
  db: SupabaseClient,
  row: {
    churchId: string;
    kind: "service_live" | "recording_published";
    subjectType: "stream_event" | "stream_recording";
    subjectId: string;
    dedupeFor: string;
    visibility: "public" | "followers" | "members";
    title: string;
    body: string;
    slug: string;
    version: number;
  },
): Promise<boolean> {
  const { error } = await db.from("notification_outbox").insert({
    church_id: row.churchId,
    kind: row.kind,
    subject_type: row.subjectType,
    subject_id: row.subjectId,
    target_visibility: row.visibility,
    topic: TOPIC,
    title: row.title.slice(0, 120),
    body: row.body.slice(0, 180),
    deep_link: `faithform://church/${row.slug}/watch`,
    collapse_key: `${row.kind}-${row.subjectId}`,
    // Once per broadcast / once per recording. A retried Go Live, a heartbeat
    // that lands twice, or a second publish collides here instead of pinging a
    // congregation again.
    dedupe_key: dedupeKey(row.kind, row.dedupeFor),
    subject_version: row.version,
  });
  return !error;
}

export async function notifyServiceLive(
  input: { churchId: string; eventId: string; sessionId: string },
  client?: SupabaseClient,
): Promise<boolean> {
  const db = client ?? createAdminClient();
  const { data: settings } = await db
    .from("stream_recording_settings")
    .select("notify_on_live")
    .eq("church_id", input.churchId)
    .maybeSingle();
  if (!settings?.notify_on_live) return false;

  const { data: event } = await db
    .from("stream_events")
    .select("title, mobile_visibility, mobile_publication_version, status")
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .maybeSingle();
  if (!event || event.status !== "live" || event.mobile_visibility === "none") return false;

  const slug = await churchSlug(db, input.churchId);
  if (!slug) return false;

  const title = (event.title as string) || "Service";
  return enqueue(db, {
    churchId: input.churchId,
    kind: "service_live",
    subjectType: "stream_event",
    subjectId: input.eventId,
    dedupeFor: input.sessionId,
    visibility: event.mobile_visibility as "public" | "followers" | "members",
    title: `${title} is live now`,
    body: "Tap to watch.",
    slug,
    version: Number(event.mobile_publication_version ?? 1),
  });
}

export async function notifyRecordingPublished(
  input: { churchId: string; recordingId: string },
  client?: SupabaseClient,
): Promise<boolean> {
  const db = client ?? createAdminClient();
  const { data: recording } = await db
    .from("stream_recordings")
    .select("title, mobile_visibility, mobile_publication_version")
    .eq("id", input.recordingId)
    .eq("church_id", input.churchId)
    .maybeSingle();
  if (!recording || recording.mobile_visibility === "none") return false;

  const slug = await churchSlug(db, input.churchId);
  if (!slug) return false;

  const title = (recording.title as string) || "This week's service";
  return enqueue(db, {
    churchId: input.churchId,
    kind: "recording_published",
    subjectType: "stream_recording",
    subjectId: input.recordingId,
    dedupeFor: input.recordingId,
    visibility: recording.mobile_visibility as "public" | "followers" | "members",
    title: `${title} is now available to watch`,
    body: "Watch it in the app.",
    slug,
    version: Number(recording.mobile_publication_version ?? 1),
  });
}

/** Withdraws pending notifications about something that is no longer published. */
export async function cancelRecordingNotifications(
  recordingId: string,
  client?: SupabaseClient,
): Promise<void> {
  const db = client ?? createAdminClient();
  await db
    .from("notification_outbox")
    .update({ status: "cancelled", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("subject_type", "stream_recording")
    .eq("subject_id", recordingId)
    .in("status", ["pending", "claimed"]);
}
