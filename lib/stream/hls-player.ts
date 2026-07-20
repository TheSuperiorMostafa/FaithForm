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

/** Public watch page — stay near the live edge with minimal buffer. */
export function createLiveHlsPlayer(HlsCtor: typeof Hls): Hls {
  return new HlsCtor({
    ...BASE_CONFIG,
    lowLatencyMode: false,
    startPosition: -1,
    liveSyncDurationCount: 1,
    liveMaxLatencyDurationCount: 4,
    maxLiveSyncPlaybackRate: 1.5,
    liveBackBufferLength: 0,
    backBufferLength: 0,
    maxBufferLength: 8,
    maxMaxBufferLength: 12,
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
    if (drift > 4) {
      seekVideoToLiveEdge(video, 1);
    }
  };

  tick();
  const id = window.setInterval(tick, 2000);
  return () => window.clearInterval(id);
}

export function attachHlsErrorRecovery(
  instance: Hls,
  HlsCtor: typeof Hls,
  onFatal: () => void,
): void {
  let fatalRetries = 0;

  instance.on(HlsCtor.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;

    if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
      instance.startLoad();
      return;
    }

    if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
      fatalRetries += 1;
      if (fatalRetries <= 3) {
        instance.recoverMediaError();
        return;
      }
    }

    onFatal();
  });

  instance.on(HlsCtor.Events.FRAG_BUFFERED, () => {
    fatalRetries = 0;
  });
}

export function rewriteM3u8Playlist(body: string, playlistUrl: string): string {
  const base = playlistUrl.replace(/\/[^/]*$/, "/");

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
