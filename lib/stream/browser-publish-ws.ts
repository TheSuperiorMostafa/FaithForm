function pickRecorderMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "video/webm";
}

/**
 * Roughly a second of video at the configured bitrate. Beyond this the uplink
 * is not keeping up and latency is growing monotonically.
 */
const MAX_BUFFERED_BYTES = 400_000;
/** How long the backlog may stay over the ceiling before we give up. */
const BACKLOG_GRACE_MS = 5_000;

export async function publishViaWebSocket(
  wsUrl: string,
  stream: MediaStream,
  onFatal?: (message: string) => void,
): Promise<{ stop: () => void }> {
  if (stream.getAudioTracks().length === 0) {
    throw new Error(
      "No microphone detected. Allow mic access in your browser settings.",
    );
  }

  const ws = await openWebSocket(wsUrl);

  const mimeType = pickRecorderMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });

  // WebM over a socket is one continuous byte stream, so individual chunks can
  // never be dropped without corrupting it for the relay's demuxer. Instead,
  // watch the send backlog: a sustained overrun means the uplink cannot carry
  // the broadcast, and failing loudly beats silently growing delay forever.
  let backlogSince: number | null = null;
  const backlogWatchdog = window.setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
      backlogSince = null;
      return;
    }

    backlogSince ??= performance.now();
    if (performance.now() - backlogSince >= BACKLOG_GRACE_MS) {
      onFatal?.(
        "Your upload speed cannot keep up with the broadcast. The stream was stopped.",
      );
      cleanup();
    }
  }, 1_000);

  const cleanup = () => {
    window.clearInterval(backlogWatchdog);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    ws.close();
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  });

  recorder.addEventListener("error", () => {
    cleanup();
  });

  ws.addEventListener("close", () => {
    window.clearInterval(backlogWatchdog);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  });

  recorder.start(100);

  return {
    stop: cleanup,
  };
}

function openWebSocket(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      ws.close();
      reject(error);
    };

    const timeout = window.setTimeout(() => {
      fail(new Error("Timed out connecting to the stream relay."));
    }, 15_000);

    ws.addEventListener("error", () => {
      fail(new Error("Could not connect to the stream relay."));
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || settled) return;

      try {
        const payload = JSON.parse(event.data) as { ok?: boolean; error?: string };
        if (payload.error) {
          fail(new Error(payload.error));
          return;
        }
        if (payload.ok) {
          settled = true;
          window.clearTimeout(timeout);
          resolve(ws);
        }
      } catch {
        // Ignore non-JSON messages.
      }
    });
  });
}
