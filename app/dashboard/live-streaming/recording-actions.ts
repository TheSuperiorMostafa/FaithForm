"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/activity/admin-log";
import { toUserError } from "@/lib/errors/user-error";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import {
  chooseThumbnail,
  deleteRecordingPermanently,
  getStaffRecording,
  publishRecording,
  saveRecordingSettings,
  trimRecording,
  unpublishRecording,
  updateRecordingDetails,
  type AppVisibility,
  type StaffRecording,
} from "@/lib/stream/recording-publication";
import { logRecordingEvent } from "@/lib/stream/recording-lifecycle";
import type { RecordingSettings } from "@/lib/stream/recording-repo";
import { rotateStreamPublishSecret } from "@/lib/stream/relay";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything a church does to a livestream recording from the dashboard.
 *
 * Every action resolves the church from the caller's own session, requires
 * the Live Stream feature and an admin, and passes the church id down so a
 * recording id from another church matches nothing. Nothing here trusts the
 * browser's idea of a recording's state: each call re-reads it.
 */

export type RecordingActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(): Promise<
  { ok: true; churchId: string; userId: string } | { ok: false; error: string }
> {
  const denied = await featureActionError("live_stream");
  if (denied) return { ok: false, error: denied };
  const auth = await getChurchAuth();
  if (!auth) return { ok: false, error: "You must be signed in." };
  if (!auth.isAdmin) return { ok: false, error: "Only a church admin can do that." };
  return { ok: true, churchId: auth.churchId, userId: auth.userId };
}

function revalidate(recordingId?: string) {
  revalidatePath("/dashboard/live-streaming");
  revalidatePath("/dashboard/live-streaming/recordings");
  revalidatePath("/dashboard/live-streaming/upcoming");
  if (recordingId) revalidatePath(`/dashboard/live-streaming/recordings/${recordingId}`);
}

export async function publishRecordingAction(input: {
  recordingId: string;
  appVisibility: AppVisibility | null;
  website: boolean;
  notifyMembers: boolean;
}): Promise<RecordingActionResult<StaffRecording | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(input.recordingId)) return { ok: false, error: "That recording is no longer available." };
  if (input.appVisibility !== null && !["public", "followers", "members"].includes(input.appVisibility)) {
    return { ok: false, error: "Choose who can see it." };
  }

  const result = await publishRecording({
    churchId: auth.churchId,
    recordingId: input.recordingId,
    actorUserId: auth.userId,
    via: "staff",
    appVisibility: input.appVisibility,
    website: Boolean(input.website),
    notifyMembers: Boolean(input.notifyMembers),
  });
  revalidate(input.recordingId);
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, data: result.recording };
}

export async function unpublishRecordingAction(recordingId: string): Promise<RecordingActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(recordingId)) return { ok: false, error: "That recording is no longer available." };
  const result = await unpublishRecording({ churchId: auth.churchId, recordingId, actorUserId: auth.userId });
  revalidate(recordingId);
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error ?? "We couldn't unpublish that recording. Please try again." };
}

export async function deleteRecordingAction(recordingId: string): Promise<RecordingActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(recordingId)) return { ok: false, error: "That recording is no longer available." };
  const result = await deleteRecordingPermanently({ churchId: auth.churchId, recordingId, actorUserId: auth.userId });
  if (result.ok) {
    await logAdminAction({
      churchId: auth.churchId,
      taskName: "Deleted a livestream recording",
      triggerSource: `stream:recording-deleted:${recordingId}`,
    });
  }
  revalidate();
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error ?? "We couldn't delete that recording. Please try again." };
}

export async function saveRecordingDetailsAction(input: {
  recordingId: string;
  title: string;
  description: string;
  speaker: string;
  seriesId: string | null;
  newSeriesName?: string;
  listedOnWebsite?: boolean;
  chapters?: string[];
  topics?: string[];
}): Promise<RecordingActionResult<StaffRecording | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(input.recordingId)) return { ok: false, error: "That recording is no longer available." };
  if (input.seriesId !== null && !UUID.test(input.seriesId)) return { ok: false, error: "Choose a series." };

  const result = await updateRecordingDetails({
    churchId: auth.churchId,
    recordingId: input.recordingId,
    title: input.title,
    description: input.description,
    speaker: input.speaker,
    seriesId: input.seriesId,
    newSeriesName: input.newSeriesName ?? null,
    listedOnWebsite: input.listedOnWebsite,
    chapters: Array.isArray(input.chapters) ? input.chapters.map(String) : undefined,
    topics: Array.isArray(input.topics) ? input.topics.map(String) : undefined,
  });
  revalidate(input.recordingId);
  if (!result.ok) return result;
  return { ok: true, data: await getStaffRecording(auth.churchId, input.recordingId) };
}

export async function trimRecordingAction(input: {
  recordingId: string;
  startSec: number;
  endSec: number | null;
}): Promise<RecordingActionResult<{ startSec: number; endSec: number | null; durationSec: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(input.recordingId)) return { ok: false, error: "That recording is no longer available." };
  const result = await trimRecording({
    churchId: auth.churchId,
    recordingId: input.recordingId,
    startSec: Number(input.startSec),
    endSec: input.endSec === null ? null : Number(input.endSec),
  });
  revalidate(input.recordingId);
  if (!result.ok) return result;
  return { ok: true, data: { startSec: result.startSec, endSec: result.endSec, durationSec: result.durationSec } };
}

export async function chooseThumbnailAction(input: {
  recordingId: string;
  url: string | null;
}): Promise<RecordingActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(input.recordingId)) return { ok: false, error: "That recording is no longer available." };
  const result = await chooseThumbnail({ churchId: auth.churchId, recordingId: input.recordingId, url: input.url });
  revalidate(input.recordingId);
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error ?? "We couldn't save that. Please try again." };
}

export async function saveRecordingSettingsAction(settings: RecordingSettings): Promise<RecordingActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!["public", "followers", "members"].includes(settings.defaultVisibility)) {
    return { ok: false, error: "Choose who can see recordings by default." };
  }
  if (settings.defaultSeriesId !== null && !UUID.test(settings.defaultSeriesId)) {
    return { ok: false, error: "Choose a series." };
  }
  const result = await saveRecordingSettings({
    churchId: auth.churchId,
    userId: auth.userId,
    settings: {
      autoPublish: Boolean(settings.autoPublish),
      defaultVisibility: settings.defaultVisibility,
      defaultSeriesId: settings.defaultSeriesId,
      publishToWebsite: Boolean(settings.publishToWebsite),
      notifyOnLive: Boolean(settings.notifyOnLive),
      notifyOnPublish: Boolean(settings.notifyOnPublish),
    },
  });
  revalidatePath("/dashboard/live-streaming/setup");
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error ?? "We couldn't save that. Please try again." };
}

/**
 * Issues a new stream key. The old one stops working for the next
 * connection, which is the point — so it is refused while a service is on air.
 */
export async function rotateStreamKeyAction(): Promise<RecordingActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const limit = await assertRateLimit(`stream:rotate-key:${auth.churchId}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) return { ok: false, error: "You've done that a few times already. Try again later." };

  const admin = createAdminClient();
  if (await getActiveStreamSession(auth.churchId, admin)) {
    return { ok: false, error: "End the livestream before changing the stream key." };
  }
  if (await isPreviewIngestActive(auth.churchId, admin)) {
    return { ok: false, error: "Stop your streaming software before changing the stream key." };
  }

  const rotated = await rotateStreamPublishSecret(auth.churchId, admin);
  if (!rotated) return { ok: false, error: "Streaming isn't set up for this church yet." };

  await logAdminAction({
    churchId: auth.churchId,
    taskName: "Replaced the church stream key",
    triggerSource: `stream:key-rotated:${auth.churchId}:${Date.now()}`,
  });
  // Recorded without the key, obviously.
  logRecordingEvent("stream_key_rotated", { churchId: auth.churchId });
  revalidatePath("/dashboard/live-streaming/setup");
  return { ok: true, data: undefined };
}

export async function retryRecordingAction(recordingId: string): Promise<RecordingActionResult<StaffRecording | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;
  if (!UUID.test(recordingId)) return { ok: false, error: "That recording is no longer available." };
  const { productionLifecycleDeps } = await import("@/lib/stream/recording-runtime");
  const { retryRecording } = await import("@/lib/stream/recording-lifecycle");
  const deps = productionLifecycleDeps();
  const row = await deps.repo.getRecording(auth.churchId, recordingId);
  if (!row) return { ok: false, error: "That recording is no longer available." };
  try {
    await retryRecording(deps, row);
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn't try that recording again.") };
  }
  revalidate(recordingId);
  return { ok: true, data: await getStaffRecording(auth.churchId, recordingId) };
}
