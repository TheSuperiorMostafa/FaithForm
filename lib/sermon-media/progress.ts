/**
 * Plain-language progress and time left for a transcription or render job.
 *
 * The worker reports a stage and a 0..1 fraction about every 10 seconds. Time
 * left uses what has been measured so far once there is enough of it, and
 * otherwise a model of the stages measured on a real 82-minute service on an
 * L4 (Nov 2026): ~45 s start-up, download and audio preparation scaling with
 * length, recognition at ~0.006 s per audio second.
 */
export type JobLike = {
  kind: "transcribe" | "render_clip";
  status: "queued" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string | null;
  progress: number | null;
  created_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type JobProgress = {
  state: "waiting" | "working" | "done" | "failed" | "cancelled";
  label: string;
  /** 0..100, never moves backwards for the same job within one response. */
  percent: number;
  /** Seconds left, or null while too early to say. */
  etaSec: number | null;
  /** Expected total seconds from start, for client-side smoothing. */
  expectedTotalSec: number;
  startedAt: string | null;
};

const TRANSCRIBE_STAGES: Record<string, string> = {
  waiting_for_worker: "Starting up",
  starting: "Starting up",
  sources: "Getting the recording",
  download: "Downloading the recording",
  language: "Detecting the language",
  asr: "Transcribing",
  events: "Listening for music and applause",
  assemble: "Putting the transcript together",
  saving: "Saving",
  done: "Done",
};

const RENDER_STAGES: Record<string, string> = {
  waiting_for_worker: "Starting up",
  starting: "Starting up",
  sources: "Getting the recording",
  render: "Making the video",
  upload: "Saving the video",
  done: "Done",
};

export function expectedTranscribeSec(audioSec: number): number {
  const audio = Math.max(60, audioSec || 0);
  return Math.round(45 + audio * 0.012 + audio * 0.0016 + audio * 0.006 + 25);
}

export function expectedRenderSec(clipSec: number): number {
  return Math.round(30 + Math.max(3, clipSec) * 1.2);
}

export function describeJob(job: JobLike | null, mediaSec: number, now = Date.now()): JobProgress | null {
  if (!job) return null;
  const expectedTotalSec =
    job.kind === "transcribe" ? expectedTranscribeSec(mediaSec) : expectedRenderSec(mediaSec);
  const labels = job.kind === "transcribe" ? TRANSCRIBE_STAGES : RENDER_STAGES;
  const base = { expectedTotalSec, startedAt: job.started_at ?? job.dispatched_at };

  if (job.status === "succeeded") return { ...base, state: "done", label: "Done", percent: 100, etaSec: 0 };
  if (job.status === "failed") return { ...base, state: "failed", label: "Couldn't finish", percent: 0, etaSec: null };
  if (job.status === "cancelled") return { ...base, state: "cancelled", label: "Stopped", percent: 0, etaSec: null };
  if (job.status === "queued") {
    return { ...base, state: "waiting", label: "Waiting to start", percent: 0, etaSec: expectedTotalSec + 30 };
  }

  const fraction = Math.max(0, Math.min(0.99, job.progress ?? 0));
  const startMs = Date.parse(job.started_at ?? job.dispatched_at ?? job.created_at);
  const elapsed = Math.max(0, (now - startMs) / 1000);
  let etaSec: number | null;
  if (fraction >= 0.3 && elapsed > 20) {
    // Measured pace, blended with the model so one slow download doesn't swing it.
    const measured = (elapsed / fraction) * (1 - fraction);
    const modelled = Math.max(5, expectedTotalSec - elapsed);
    etaSec = Math.round(0.7 * measured + 0.3 * modelled);
  } else {
    etaSec = Math.max(10, Math.round(expectedTotalSec - elapsed));
  }
  return {
    ...base,
    state: "working",
    label: labels[job.stage ?? ""] ?? "Working",
    percent: Math.max(1, Math.round(fraction * 100)),
    etaSec,
  };
}

export function formatEta(sec: number | null): string {
  if (sec === null) return "";
  if (sec < 45) return "less than a minute left";
  const minutes = Math.round(sec / 60);
  return minutes === 1 ? "about a minute left" : `about ${minutes} minutes left`;
}
