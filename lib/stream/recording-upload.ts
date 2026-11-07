// Standard signed uploads support up to 5 GB. Storage can impose a lower limit.
export const MAX_RECORDING_UPLOAD_BYTES = 5_000_000_000;
export const MIN_RECORDING_OPTIMIZE_BYTES = 20 * 1024 * 1024;

export function validateRecordingUpload(input: { title: string; filename: string; size: number }): string | null {
  if (!input.title.trim() || input.title.trim().length > 120) return "Enter a recording title of up to 120 characters.";
  if (!/\.mp4$/i.test(input.filename)) return "Choose an MP4 video. Export it with H.264 video and AAC audio so it plays on phones.";
  if (!Number.isSafeInteger(input.size) || input.size <= 0) return "Choose an MP4 video that isn't empty.";
  if (input.size > MAX_RECORDING_UPLOAD_BYTES) return "This video is too large. Choose an MP4 up to 5 GB.";
  return null;
}

export function describeRecordingUploadError(error: { status?: number; statusCode?: string }): string {
  if (error.status === 413 || error.statusCode === "413" || error.statusCode === "EntityTooLarge") {
    return "The video exceeds the storage limit. Export a smaller MP4, then try again.";
  }
  return "The video couldn't be uploaded. Check your connection and try again. If it keeps happening, contact FaithForm support.";
}

/** Uploads stay private until the normal recording review/publish flow. */
export function recordingUploadPath(churchId: string, recordingId: string): string {
  return `relay/${churchId}/upload-${recordingId}.mp4`;
}
