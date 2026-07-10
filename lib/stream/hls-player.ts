import type Hls from "hls.js";

export function createHlsPlayer(HlsCtor: typeof Hls): Hls {
  return new HlsCtor({
    enableWorker: true,
    lowLatencyMode: false,
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 10,
    maxLiveSyncPlaybackRate: 1.5,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 4,
    levelLoadingMaxRetry: 4,
  });
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

  return body
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
