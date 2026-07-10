export async function publishViaHttpIngest(
  ingestUrl: string,
  stream: MediaStream,
): Promise<{ stop: () => void }> {
  const mimeType = pickRecorderMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 128_000,
  });

  let uploadError: Error | null = null;
  let stopUpload: (() => void) | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size === 0) return;
        void event.data.arrayBuffer().then((buffer) => {
          controller.enqueue(new Uint8Array(buffer));
        });
      });

      recorder.addEventListener("stop", () => {
        controller.close();
      });

      recorder.addEventListener("error", () => {
        controller.error(new Error("Could not record camera output."));
      });
    },
  });

  const uploadPromise = fetch(ingestUrl, {
    method: "POST",
    body,
    headers: { "Content-Type": mimeType },
    // Required for streaming request bodies in Chromium.
    duplex: "half",
  } as RequestInit).then(async (response) => {
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || `Ingest failed (${response.status}).`);
    }
  });

  uploadPromise.catch((error: unknown) => {
    uploadError =
      error instanceof Error ? error : new Error("Stream upload failed.");
  });

  stopUpload = () => {
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
  };

  recorder.start(250);

  await waitForIngestStart(uploadPromise, () => uploadError);

  return {
    stop: () => {
      stopUpload?.();
    },
  };
}

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

async function waitForIngestStart(
  uploadPromise: Promise<void>,
  getError: () => Error | null,
): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 1500));
  const error = getError();
  if (error) {
    throw error;
  }

  uploadPromise.catch(() => {
    // Surface on stop or next publish attempt.
  });
}
