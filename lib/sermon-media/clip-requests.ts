import { describeJob, type JobLike, type JobProgress } from "@/lib/sermon-media/progress";

/**
 * Where each "Make clips" request stands, for the Clips page.
 *
 * A request made before the recording had a transcript is remembered on its
 * transcription job (`params.make_clips`). From there it can still be writing
 * out the service, waiting for the next run to find the moments, done (its
 * clips are in Ready to review), or stopped somewhere. Everything but "done"
 * is shown, in plain words, so the page never says "No clips waiting" while
 * clips are on their way or after they failed. Pure, so it can be tested.
 */
export const NO_MOMENTS_MESSAGE =
  "We couldn't find a clear moment to clip in this service. This can happen when the sermon is short, the sound is hard to hear, or music plays under most of it.";

/** Finished requests stay on the page this long; live ones stay until they finish. */
export const CLIP_REQUEST_LOOKBACK_MS = 3 * 86_400_000;
/** A job still waiting to start after this long is called out. */
const SLOW_START_MS = 15 * 60_000;

const LIVE = new Set(["queued", "dispatched", "running"]);

export type ClipRequestState = "transcribing" | "finding" | "failed" | "no_moments";

export type ClipRequestView = {
  recordingId: string;
  title: string;
  state: ClipRequestState;
  /** Short status, e.g. "Writing out the service". */
  label: string;
  /** One or two plain sentences: what is happening, or what went wrong and what to do. */
  detail: string;
  /** A person can press Make clips again for this recording. */
  canRetry: boolean;
  progress: JobProgress | null;
};

export type ClipRequestJob = JobLike & {
  recording_id: string;
  updated_at: string;
  last_error_code: string | null;
};

export type ClipRequestInput = {
  /** Transcription jobs carrying a Make clips request, newest first. */
  jobs: ClipRequestJob[];
  recordings: Map<string, { title: string | null; durationSec: number | null; deleted: boolean }>;
  /** recording_sermon_media for those recordings. */
  states: Map<string, { transcriptVersion: number | null; pipelineVersion: number | null }>;
  /** Clips per recording that show in the Clips lists (not archived, not a raw suggestion). */
  clipCounts: Map<string, number>;
  now?: number;
};

/** recording_sermon_media.pipeline_input_version markers: the run failed, or the church had the feature off. */
export const PIPELINE_FAILED = -1;
export const PIPELINE_SKIPPED = -2;

const TRY_AGAIN = "Press Try again. If it happens again, contact FaithForm support.";

function failureDetail(title: string, code: string | null): string {
  if (code === "dispatch_failed") {
    return `FaithForm couldn't start writing out ${title}, so no clips were made. ${TRY_AGAIN}`;
  }
  if (code === "lease_expired") {
    return `Writing out ${title} stopped partway, so no clips were made. ${TRY_AGAIN}`;
  }
  return `We couldn't write out ${title}, so no clips were made. ${TRY_AGAIN}`;
}

export function describeClipRequests(input: ClipRequestInput): ClipRequestView[] {
  const now = input.now ?? Date.now();
  const seen = new Set<string>();
  const out: ClipRequestView[] = [];

  for (const job of input.jobs) {
    if (seen.has(job.recording_id)) continue; // only the newest request per recording
    seen.add(job.recording_id);
    const recording = input.recordings.get(job.recording_id);
    if (!recording || recording.deleted) continue;
    const title = recording.title?.trim() || "this service";
    const live = LIVE.has(job.status);
    const finishedAt = Date.parse(job.finished_at ?? job.updated_at);
    if (!live && Number.isFinite(finishedAt) && now - finishedAt > CLIP_REQUEST_LOOKBACK_MS) continue;

    const state = input.states.get(job.recording_id);
    const hasTranscript = state?.transcriptVersion !== null && state?.transcriptVersion !== undefined;
    const clips = input.clipCounts.get(job.recording_id) ?? 0;
    const base = { recordingId: job.recording_id, title };

    if (live) {
      const waitingLong = job.status === "queued" && now - Date.parse(job.created_at) > SLOW_START_MS;
      out.push({
        ...base,
        state: "transcribing",
        label: waitingLong ? "Still waiting to start" : "Writing out the service",
        detail: waitingLong
          ? `Clips from ${title} are waiting for the service to be written out, and it's taking longer than usual. FaithForm keeps trying; if nothing changes within the hour, contact FaithForm support.`
          : `FaithForm writes out ${title} first, then finds the best moments. The clips appear here when they're ready.`,
        canRetry: false,
        progress: describeJob(job, recording.durationSec ?? 0, now),
      });
      continue;
    }

    if (!hasTranscript) {
      if (job.status === "succeeded") continue; // nothing to say until the transcript shows
      out.push({
        ...base,
        state: "failed",
        label: job.status === "cancelled" ? "Stopped" : "Couldn't make clips",
        detail:
          job.status === "cancelled"
            ? `Writing out ${title} was stopped, so no clips were made. Press Try again to start over.`
            : failureDetail(title, job.last_error_code),
        canRetry: true,
        progress: null,
      });
      continue;
    }

    const pipeline = state?.pipelineVersion ?? null;
    if (pipeline === null) {
      out.push({
        ...base,
        state: "finding",
        label: "Finding the best moments",
        detail: `The service is written out. Clips from ${title} appear here in a minute or two.`,
        canRetry: false,
        progress: null,
      });
      continue;
    }
    if (pipeline === PIPELINE_SKIPPED) continue;
    if (pipeline === PIPELINE_FAILED) {
      out.push({
        ...base,
        state: "failed",
        label: "Couldn't make clips",
        detail: `Something went wrong while making clips from ${title}. ${TRY_AGAIN}`,
        canRetry: true,
        progress: null,
      });
      continue;
    }
    if (clips === 0) {
      out.push({
        ...base,
        state: "no_moments",
        label: "No clear moments found",
        detail: NO_MOMENTS_MESSAGE,
        canRetry: false,
        progress: null,
      });
    }
  }
  return out.slice(0, 10);
}

/** Keep checking while any request is still on its way. */
export function clipRequestsActive(requests: Pick<ClipRequestView, "state">[]): boolean {
  return requests.some((request) => request.state === "transcribing" || request.state === "finding");
}
