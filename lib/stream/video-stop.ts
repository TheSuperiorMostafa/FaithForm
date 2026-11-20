/**
 * When a live service ends on its own because the video stopped.
 *
 * Pressing "Stop Streaming" in OBS (or "Off Air" on an ATEM) should end the
 * service exactly as the End service button does. The relay (MediaMTX) cannot
 * tell us *why* a publisher left: its not-ready hook fires the same way for a
 * deliberate stop and for a dropped connection. What separates them is time.
 * Streaming software that lost its connection reconnects within seconds (OBS
 * retries after 2s by default), while software that was told to stop never
 * comes back. So a live service ends once video has been gone for a grace
 * window, and a brief drop keeps it going.
 *
 * Pure: no I/O, so the decision is the same in the status poll, the cron and
 * the tests.
 */

/**
 * How long a live service waits for video to come back after the relay
 * reported that the streaming software stopped sending it. Long enough for a
 * network drop to reconnect, short enough that "Stop Streaming" visibly ends
 * the service within about a minute.
 */
export const ENCODER_STOP_GRACE_MS = 60_000;

/**
 * The backstop when no stop was reported at all and the relay's "still
 * publishing" heartbeats simply stopped arriving (the relay or its link to
 * FaithForm failed, so the stop message may have been lost). Longer, because
 * silence is weaker evidence than a reported stop. Counted from the last
 * heartbeat, which the relay sends every 30s.
 */
export const VIDEO_SILENCE_GRACE_MS = 120_000;

export type VideoStopReason =
  /** The relay said the streaming software stopped sending video. */
  | "stopped"
  /** No video evidence has arrived for a while, and no stop was reported. */
  | "silent";

export type VideoStopInput = {
  /** Only a service that has gone live can end this way. */
  sessionStatus: "preparing" | "waiting_for_encoder" | "live" | "ended" | "error";
  /** When the session went live; the earliest video can have been seen. */
  liveSince: string | null;
  /** Whether video is arriving right now, by any evidence. */
  videoArriving: boolean;
  /** The newest proof that video was arriving (a relay publish heartbeat). */
  lastVideoAt: string | null;
  /** When the relay last reported that the streaming software stopped. */
  stoppedAt: string | null;
  now: number;
};

export type VideoStopDecision =
  | { action: "keep" }
  | { action: "wait"; reason: VideoStopReason; endsAt: string }
  | { action: "end"; reason: VideoStopReason; endsAt: string };

function time(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function decideVideoStop(input: VideoStopInput): VideoStopDecision {
  if (input.sessionStatus !== "live" || input.videoArriving) return { action: "keep" };

  const liveSince = time(input.liveSince);
  const beat = time(input.lastVideoAt);
  const lastVideo = Math.max(liveSince ?? -Infinity, beat ?? -Infinity);
  const stopped = time(input.stoppedAt);

  let reason: VideoStopReason;
  let deadline: number;
  // A stop counts only if no video was seen after it: a later heartbeat means
  // the software reconnected, and anything after that is silence, not a stop.
  if (stopped !== null && stopped >= lastVideo) {
    reason = "stopped";
    deadline = stopped + ENCODER_STOP_GRACE_MS;
  } else if (Number.isFinite(lastVideo)) {
    reason = "silent";
    deadline = lastVideo + VIDEO_SILENCE_GRACE_MS;
  } else {
    // Live with no evidence of when video was last seen. Never guess.
    return { action: "keep" };
  }

  const endsAt = new Date(deadline).toISOString();
  return input.now >= deadline ? { action: "end", reason, endsAt } : { action: "wait", reason, endsAt };
}

/**
 * The video evidence FaithForm holds, folded into one answer: the relay's
 * publish heartbeats (and its reported stop) plus the recorder's heartbeat.
 */
export function videoEvidence(input: {
  preview: { active: boolean; lastBeatAt: string | null; stoppedAt: string | null };
  ingest: { publishing: boolean; heartbeatAt: string } | null;
  /** How long a recorder heartbeat counts as "video is arriving". */
  ingestTtlMs: number;
  now: number;
}): { videoArriving: boolean; lastVideoAt: string | null; stoppedAt: string | null } {
  const ingestBeat = input.ingest?.publishing ? input.ingest.heartbeatAt : null;
  const ingestFresh =
    ingestBeat !== null && input.now - Date.parse(ingestBeat) <= input.ingestTtlMs;
  const beats = [input.preview.lastBeatAt, ingestBeat].filter(
    (value): value is string => value !== null && !Number.isNaN(Date.parse(value)),
  );
  const lastVideoAt = beats.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;
  return {
    videoArriving: input.preview.active || ingestFresh,
    lastVideoAt,
    stoppedAt: input.preview.stoppedAt,
  };
}
