/**
 * Where transcripts and clips live in the dashboard: inside Live > Recordings.
 * Each recording has its transcript at `<recording>/transcript`, and every
 * church's clips wait for review at `recordings/clips`. The old
 * `/dashboard/transcripts` and `/dashboard/clips` URLs redirect here.
 */
export const RECORDINGS_BASE_HREF = "/dashboard/live-streaming/recordings";
export const CLIPS_HREF = `${RECORDINGS_BASE_HREF}/clips`;

export function clipHref(clipId: string): string {
  return `${CLIPS_HREF}/${encodeURIComponent(clipId)}`;
}

export function recordingPageHref(recordingId: string): string {
  return `${RECORDINGS_BASE_HREF}/${encodeURIComponent(recordingId)}`;
}

/** The recording's transcript, optionally opened at a moment (`?t=` seconds). */
export function transcriptHref(recordingId: string, atSec?: number | null): string {
  const base = `${recordingPageHref(recordingId)}/transcript`;
  return atSec !== undefined && atSec !== null && Number.isFinite(atSec) && atSec >= 0
    ? `${base}?t=${Math.floor(atSec)}`
    : base;
}
