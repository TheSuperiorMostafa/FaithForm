import type { StatusTone } from "@/components/ui/status-badge";
import { listStaffRecordings } from "@/lib/stream/recording-publication";
import { recordingTone } from "@/lib/stream/recording-status";

/**
 * Each recording's canonical state by id, for the tiles in Recordings ›
 * Series. A tile without a known state shows no badge rather than a wrong
 * one, so a failure here only costs the badges.
 */
export async function loadRecordingStatuses(
  churchId: string,
): Promise<Record<string, { label: string; tone: StatusTone }>> {
  const recordings = await listStaffRecordings(churchId, { limit: 100 }).catch(() => []);
  return Object.fromEntries(
    recordings.map((recording) => [
      recording.id,
      { label: recording.phase.label, tone: recordingTone(recording.phase.phase) },
    ]),
  );
}
