import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyRecording } from "@/lib/media/v1/rendition-check";
import { staffExplanation } from "@/lib/media/v1/rendition";
import { isRecordingStoragePathForChurch, STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { recordingUploadPath } from "@/lib/stream/recording-upload";

/** Called only after the server action resolves an authorized church admin. */
export async function finalizeUploadedRecording(input: { churchId: string; recordingId: string }, db: SupabaseClient) {
  const path = recordingUploadPath(input.churchId, input.recordingId);
  const { data: row, error } = await db.from("stream_recordings").select("status, total_bytes, deleted_at")
    .eq("id", input.recordingId).eq("church_id", input.churchId).eq("storage_path", path).eq("source_kind", "file").maybeSingle();
  if (error) throw error;
  if (!row || row.deleted_at || !["processing", "ready"].includes(row.status)) return { ok: false as const, error: "That upload is no longer available." };
  const { data: object, error: objectError } = await db.storage.from(STREAM_RECORDINGS_BUCKET).info(path);
  if (objectError || !object || Number(object.size) !== Number(row.total_bytes)) return { ok: false as const, error: "The video hasn't finished uploading. Please try again." };
  if (row.status === "processing") {
    const { data: updated, error: updateError } = await db.from("stream_recordings")
      .update({ status: "ready", ready_at: new Date().toISOString(), finalized_by: "legacy" })
      .eq("id", input.recordingId).eq("church_id", input.churchId).eq("storage_path", path).eq("status", "processing").is("deleted_at", null)
      .select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) return { ok: false as const, error: "The upload changed while it was being checked. Please try again." };
  }
  const verdict = await verifyRecording({ recordingId: input.recordingId, churchId: input.churchId, storagePath: path }, db);
  if (!verdict.verifiedAt) return { ok: false as const, error: "Your video uploaded, but we couldn't finish checking it. Choose Finish upload to try again. The video will not upload again." };
  return { ok: true as const, recordingId: input.recordingId };
}

/** A transient check must be recoverable for file uploads as well as live segments. */
export async function recheckFileRecording(input: { churchId: string; recordingId: string }, db: SupabaseClient) {
  const { data: row, error } = await db.from("stream_recordings").select("source_kind, status, storage_path, deleted_at")
    .eq("id", input.recordingId).eq("church_id", input.churchId).maybeSingle();
  if (error) throw error;
  if (!row || row.deleted_at || row.source_kind !== "file" || !["ready", "published"].includes(row.status) ||
      !isRecordingStoragePathForChurch(row.storage_path, input.churchId)) return { ok: false as const, error: "This recording is not ready to check. Finish uploading it first." };
  const verdict = await verifyRecording({ ...input, storagePath: row.storage_path }, db);
  if (!verdict.verifiedAt) return { ok: false as const, error: "We couldn't check your video right now. Your upload is saved. Try Recheck video in a few minutes." };
  if (!verdict.playable) return { ok: false as const, error: staffExplanation(verdict.reason) };
  return { ok: true as const };
}
