import { isJobActive, type JobStatus } from "@/components/sermon-media/api";

/**
 * Where a service stands in the Transcripts section, in one word the page can
 * switch on. A running job wins over an existing transcript, so a redo shows
 * its progress; a recording that is still being prepared can't be transcribed.
 */
export type TranscriptStatusKind =
  | "working"
  | "ready"
  | "preparing"
  | "video_problem"
  | "failed"
  | "stopped"
  | "none";

export function transcriptStatus(input: {
  recordingStatus: string;
  transcriptReady: boolean;
  job: { status: JobStatus } | null;
}): TranscriptStatusKind {
  if (isJobActive(input.job)) return "working";
  if (input.transcriptReady) return "ready";
  if (input.recordingStatus === "processing") return "preparing";
  if (input.recordingStatus === "failed") return "video_problem";
  if (input.job?.status === "failed") return "failed";
  if (input.job?.status === "cancelled") return "stopped";
  return "none";
}

/** Whether "Transcribe" / "Try again" can be pressed for this status. */
export const canStartTranscript = (kind: TranscriptStatusKind): boolean =>
  kind === "none" || kind === "failed" || kind === "stopped";
