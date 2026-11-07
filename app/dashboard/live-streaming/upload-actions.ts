"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { UserFacingError, toUserError } from "@/lib/errors/user-error";
import { verifyRecording } from "@/lib/media/v1/rendition-check";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { recordingUploadPath, validateRecordingUpload } from "@/lib/stream/recording-upload";
import { createAdminClient } from "@/lib/supabase/admin";

async function uploadAuth() {
  const denied = await featureActionError("live_stream");
  if (denied) throw new UserFacingError(denied);
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) throw new UserFacingError("Only a church admin can upload recordings.");
  return auth;
}

export async function prepareRecordingUpload(input: { title: string; filename: string; size: number; durationSec: number }) {
  try {
    const auth = await uploadAuth();
    const invalid = validateRecordingUpload(input);
    if (invalid) return { ok: false as const, error: invalid };
    if (!Number.isFinite(input.durationSec) || input.durationSec < 5 || input.durationSec > 12 * 60 * 60) return { ok: false as const, error: "Choose a video between 5 seconds and 12 hours long." };
    const limit = await assertRateLimit(`recording-upload:${auth.churchId}:${auth.userId}`, { limit: 10, windowMs: 60 * 60 * 1000 });
    if (!limit.ok) return { ok: false as const, error: "Please wait a few minutes before uploading another recording." };
    const admin = createAdminClient();
    const id = randomUUID();
    const path = recordingUploadPath(auth.churchId, id);
    const { data, error } = await admin.storage.from(STREAM_RECORDINGS_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw error ?? new Error("Upload unavailable");
    const { error: insertError } = await admin.from("stream_recordings").insert({
      id, church_id: auth.churchId, title: input.title.trim(), storage_path: path,
      source_kind: "file", status: "processing", total_bytes: input.size, duration_sec: input.durationSec,
      processing_started_at: new Date().toISOString(),
    });
    if (insertError) throw insertError;
    return { ok: true as const, recordingId: id, path, token: data.token };
  } catch (error) {
    return { ok: false as const, error: toUserError(error, "We couldn't start that upload. Please try again.") };
  }
}

export async function finishRecordingUpload(recordingId: string) {
  try {
    const auth = await uploadAuth();
    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return { ok: false as const, error: "That upload is no longer available." };
    const admin = createAdminClient();
    const path = recordingUploadPath(auth.churchId, recordingId);
    const { data: row, error } = await admin.from("stream_recordings").select("status, total_bytes")
      .eq("id", recordingId).eq("church_id", auth.churchId).eq("storage_path", path).eq("source_kind", "file").maybeSingle();
    if (error) throw error;
    if (!row || !["processing", "ready"].includes(row.status)) return { ok: false as const, error: "That upload is no longer available." };
    const { data: object, error: objectError } = await admin.storage.from(STREAM_RECORDINGS_BUCKET).info(path);
    if (objectError || !object || Number(object.size) !== Number(row.total_bytes)) return { ok: false as const, error: "The video hasn't finished uploading. Please try again." };
    const { error: updateError } = await admin.from("stream_recordings").update({ status: "ready", ready_at: new Date().toISOString(), finalized_by: "legacy" })
      .eq("id", recordingId).eq("church_id", auth.churchId).eq("storage_path", path).eq("status", "processing");
    if (updateError) throw updateError;
    // The canonical probe reads actual bytes and binds publication to the object.
    // A rejected codec stays visible for review but cannot be published.
    await verifyRecording({ recordingId, churchId: auth.churchId, storagePath: path }, admin);
    revalidatePath("/dashboard/live-streaming/recordings");
    return { ok: true as const, recordingId };
  } catch (error) {
    return { ok: false as const, error: toUserError(error, "We couldn't finish that upload. Please try again.") };
  }
}

export async function cancelRecordingUpload(recordingId: string) {
  try {
    const auth = await uploadAuth();
    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return;
    const admin = createAdminClient();
    const path = recordingUploadPath(auth.churchId, recordingId);
    const { data, error } = await admin.from("stream_recordings").delete().eq("id", recordingId)
      .eq("church_id", auth.churchId).eq("storage_path", path).eq("status", "processing").select("id");
    if (error || !data?.length) return;
    await admin.storage.from(STREAM_RECORDINGS_BUCKET).remove([path]);
  } catch { /* An interrupted upload remains private and cannot be published. */ }
}
