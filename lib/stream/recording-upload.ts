/** Uploads stay private until the normal recording review/publish flow. */
export const MAX_RECORDING_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
export function validateRecordingUpload(input: { title: string; filename: string; size: number }): string | null {
  if (!input.title.trim() || input.title.trim().length > 120) return "Enter a recording title of up to 120 characters.";
  if (!/\.mp4$/i.test(input.filename)) return "Choose an MP4 video. Export it with H.264 video and AAC audio so it plays on phones.";
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > MAX_RECORDING_UPLOAD_BYTES) return "Choose a video smaller than 5 GB.";
  return null;
}

export function recordingUploadPath(churchId: string, recordingId: string): string {
  return `relay/${churchId}/upload-${recordingId}.mp4`;
}
