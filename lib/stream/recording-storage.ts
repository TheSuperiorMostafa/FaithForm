export const STREAM_RECORDINGS_BUCKET = "stream-recordings";

/** Keeps a relay-supplied name from escaping its church's folder. */
export function sanitizeRecordingFilename(value: string): string | null {
  const base = value.trim().split("/").pop() ?? "";
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(base)) return null;
  if (base.startsWith(".")) return null;
  if (!/\.(mp4|mov|mkv)$/i.test(base)) return null;
  return base;
}

/**
 * Every recording lives under its own church. The app derives this rather than
 * trusting the relay, so a leaked relay secret cannot be used to write over
 * another church's library.
 */
export function buildRecordingStoragePath(
  churchId: string,
  filename: string,
): string {
  return `relay/${churchId}/${filename}`;
}

export function isRecordingStoragePathForChurch(
  storagePath: string,
  churchId: string,
): boolean {
  return storagePath.startsWith(`relay/${churchId}/`);
}
