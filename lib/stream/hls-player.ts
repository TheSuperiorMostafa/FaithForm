import type Hls from "hls.js";

const BASE_CONFIG = {
  enableWorker: true,
  fragLoadingMaxRetry: 6,
  manifestLoadingMaxRetry: 4,
  levelLoadingMaxRetry: 4,
} as const;

/** Dashboard preview — tolerates higher buffer for stability. */
export function createHlsPlayer(HlsCtor: typeof Hls): Hls {
  return new HlsCtor({
    ...BASE_CONFIG,
    lowLatencyMode: false,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    maxLiveSyncPlaybackRate: 1.5,
  });
}

/**
 * All of the live tuning below assumes the relay's HLS geometry in
 * `infra/stream-relay/mediamtx.yml`: 1s segments, 8 segments per playlist.
 * If either value changes there, revisit these constants together.
 */
const RELAY_SEGMENT_SEC = 1;
const RELAY_PLAYLIST_SEGMENTS = 8;

/**
 * Steady-state distance from the live edge, in target durations. Three is the
 * hls.js default and the HLS spec's recommended minimum; at one, any network
 * jitter exhausts the buffer and the player stalls. With 1s segments this is
 * still only ~3s of latency.
 */
export const LIVE_SYNC_DURATION_COUNT = 3;

/**
 * Only force a seek once the viewer is close to falling off the end of the
 * playlist window. Must stay above the steady-state distance implied by
 * LIVE_SYNC_DURATION_COUNT, or normal playback trips the seek on every check
 * and jumps constantly — and below the playlist window, or the viewer drops off
 * the playlist before we ever resync them.
 */
export const LIVE_EDGE_RESYNC_THRESHOLD_SEC =
  (RELAY_PLAYLIST_SEGMENTS - 2) * RELAY_SEGMENT_SEC;

/**
 * Where to land after a forced resync: back at the normal live-sync distance,
 * so playback resumes with a viable buffer instead of starving immediately.
 */
export const LIVE_EDGE_TARGET_OFFSET_SEC =
  LIVE_SYNC_DURATION_COUNT * RELAY_SEGMENT_SEC;

/** Public watch page — near the live edge, with enough buffer to stay smooth. */
export function createLiveHlsPlayer(HlsCtor: typeof Hls): Hls {
  return new HlsCtor({
    ...BASE_CONFIG,
    lowLatencyMode: false,
    startPosition: -1,
    liveSyncDurationCount: LIVE_SYNC_DURATION_COUNT,
    // Must stay inside the relay's playlist window; a larger value than the
    // playlist can express is silently unreachable.
    liveMaxLatencyDurationCount: RELAY_PLAYLIST_SEGMENTS - 2,
    // Let hls.js absorb small drift by playing slightly fast rather than
    // seeking, which is far less jarring than a jump.
    maxLiveSyncPlaybackRate: 1.5,
    // A small back buffer is required for recoverMediaError() to have anything
    // to re-append; at zero, media errors escalate straight to fatal.
    backBufferLength: 10,
    maxBufferLength: 10,
    maxMaxBufferLength: 20,
  });
}

export function seekVideoToLiveEdge(
  video: HTMLVideoElement,
  offsetSec = 1,
): number | null {
  if (video.seekable.length === 0) return null;
  const liveEdge = video.seekable.end(video.seekable.length - 1);
  const target = Math.max(liveEdge - offsetSec, 0);
  if (Math.abs(video.currentTime - target) > 0.25) {
    video.currentTime = target;
  }
  return liveEdge - video.currentTime;
}

export function attachLiveEdgeSync(
  video: HTMLVideoElement,
  onDrift?: (secondsBehind: number) => void,
): () => void {
  const tick = () => {
    if (video.seekable.length === 0) return;
    const liveEdge = video.seekable.end(video.seekable.length - 1);
    const drift = liveEdge - video.currentTime;
    onDrift?.(drift);
    // Never yank a paused viewer forward — seeking under them fights the user.
    if (drift > LIVE_EDGE_RESYNC_THRESHOLD_SEC && !video.paused) {
      seekVideoToLiveEdge(video, LIVE_EDGE_TARGET_OFFSET_SEC);
    }
  };

  tick();
  const id = window.setInterval(tick, 2000);
  return () => window.clearInterval(id);
}

const MAX_NETWORK_RETRIES = 6;
const NETWORK_RETRY_BASE_MS = 500;
const NETWORK_RETRY_MAX_MS = 8_000;

export function attachHlsErrorRecovery(
  instance: Hls,
  HlsCtor: typeof Hls,
  onFatal: () => void,
): () => void {
  let mediaRetries = 0;
  let networkRetries = 0;
  let retryTimer: number | null = null;
  let destroyed = false;

  instance.on(HlsCtor.Events.ERROR, (_event, data) => {
    if (!data.fatal || destroyed) return;

    if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
      // Reconnect with capped exponential backoff. Retrying immediately and
      // forever turns a relay outage into a request storm against the proxy.
      if (networkRetries >= MAX_NETWORK_RETRIES) {
        onFatal();
        return;
      }
      const delay = Math.min(
        NETWORK_RETRY_BASE_MS * 2 ** networkRetries,
        NETWORK_RETRY_MAX_MS,
      );
      networkRetries += 1;
      if (retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (!destroyed) instance.startLoad();
      }, delay);
      return;
    }

    if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
      mediaRetries += 1;
      if (mediaRetries <= 3) {
        instance.recoverMediaError();
        return;
      }
    }

    onFatal();
  });

  // A fragment landing means the stream is healthy again, so both budgets reset.
  instance.on(HlsCtor.Events.FRAG_BUFFERED, () => {
    mediaRetries = 0;
    networkRetries = 0;
  });

  return () => {
    destroyed = true;
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}

export function rewriteM3u8Playlist(body: string, playlistUrl: string): string {
  const base = playlistUrl.replace(/\/[^/]*$/, "/");

  // NOTE: #EXT-X-ENDLIST is deliberately stripped. The relay emits it when
  // ingest drops even briefly, which would permanently end playback for every
  // viewer; liveness is instead driven authoritatively by /api/stream/
  // public-status, which tears the player down when the session really ends.
  const sanitized = body
    .split("\n")
    .filter((line) => line.trim() !== "#EXT-X-ENDLIST")
    .join("\n");

  return sanitized
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.includes('URI="') && !trimmed.includes('URI="http')) {
          return trimmed.replace(/URI="([^"]+)"/, (_match, uri: string) => {
            if (uri.startsWith("http")) return `URI="${uri}"`;
            return `URI="${base}${uri}"`;
          });
        }
        return line;
      }
      if (trimmed.startsWith("http")) return trimmed;
      return `${base}${trimmed}`;
    })
    .join("\n");
}
