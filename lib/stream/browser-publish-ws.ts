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

export async function publishViaWebSocket(
  wsUrl: string,
  stream: MediaStream,
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

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
      ws.send(event.data);
    }
  });

  recorder.addEventListener("error", () => {
    ws.close();
  });

  ws.addEventListener("close", () => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  });

  recorder.start(250);

  return {
    stop: () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      ws.close();
    },
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
