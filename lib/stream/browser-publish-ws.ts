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
  // Previously this returned "video/webm" regardless. On a browser without WebM
  // recording (Safari records MP4 only) that produced a stream the relay's
  // `ffmpeg -f webm` could not parse, so ingest died a few seconds in with a
  // broken pipe and no indication of why. Fail here instead, actionably.
  throw new Error(
    "This browser cannot record WebM video. Use Chrome or Edge to broadcast, " +
      "or stream from OBS instead.",
  );
}

const AUDIO_BITS_PER_SECOND = 128_000;

/**
 * Bounds on the video bitrate we will ask the recorder for.
 *
 * A MediaRecorder's bitrate cannot be changed once it starts, and restarting it
 * mid-service would begin a second WebM stream that the relay's demuxer cannot
 * follow. So the rate has to be right before the first frame — hence the probe.
 * The floor is the point below which the picture is not worth broadcasting; the
 * ceiling is what a church service actually needs at 1080p30.
 */
const MIN_VIDEO_BPS = 600_000;
const MAX_VIDEO_BPS = 3_000_000;
/** Fraction of measured throughput we are willing to occupy. */
const UPLINK_UTILISATION = 0.7;
/** Used when the probe cannot get a reading — deliberately modest. */
const FALLBACK_VIDEO_BPS = 1_200_000;

/**
 * Largest WebSocket message we will send. Comfortably under the relay's own
 * frame limit, which closes the connection rather than truncating.
 */
const MAX_WS_MESSAGE_BYTES = 4 * 1024 * 1024;

const PROBE_CHUNK_BYTES = 64 * 1024;
const PROBE_TOTAL_BYTES = 512 * 1024;
const PROBE_TIMEOUT_MS = 8_000;

/**
 * Roughly a second of video at the negotiated bitrate. Past this the uplink is
 * not keeping up and latency is growing.
 */
function backlogCeiling(videoBps: number): number {
  return Math.max(200_000, Math.round((videoBps + AUDIO_BITS_PER_SECOND) / 8));
}

/** How long the backlog may sit over the ceiling before we shed quality. */
const SHED_AFTER_MS = 4_000;
/** How long a backlog may keep growing at the lowest rung before we give up. */
const FATAL_AFTER_MS = 45_000;

export type PublishHandle = {
  stop: () => void;
  videoBitsPerSecond: number;
  measuredUplinkBps: number | null;
};

export type PublishOptions = {
  /** Resolution and rate the relay should normalise the broadcast to. */
  output: { width: number; height: number; fps: number };
  /** Asked to drop a rung when the uplink falls behind. Returns false at the bottom. */
  onCongestion?: () => boolean;
  /** Current shed rung, for diagnostics only. */
  shedLevel?: () => number;
  /** Frames handed to the capture track so far, for diagnostics only. */
  framesDrawn?: () => number;
  /** Whether frames are requested explicitly rather than by the compositor. */
  manualCapture?: () => boolean;
  /** Only called when the broadcast genuinely cannot continue. */
  onFatal?: (message: string) => void;
};

/**
 * Measures how fast this connection can actually push to the relay.
 *
 * Sends padding the relay discards, and lets the *relay* report how long the
 * bytes took to arrive. Timing it here would be wrong: `bufferedAmount` reports
 * only the local send queue, and the kernel will absorb half a megabyte before
 * anything crosses the network — so a client-side reading measures how fast the
 * socket buffer filled, not the connection. A failed or implausible measurement
 * returns null and the caller falls back to a modest default.
 */
async function probeUplink(ws: WebSocket): Promise<number | null> {
  const measured = new Promise<{ bytes: number; ms: number } | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      resolve(null);
    }, PROBE_TIMEOUT_MS);

    function onMessage(event: MessageEvent) {
      if (typeof event.data !== "string") return;
      try {
        const payload = JSON.parse(event.data) as {
          event?: string;
          bytes?: number;
          ms?: number;
        };
        if (payload.event !== "probe_result") return;
        window.clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve({ bytes: payload.bytes ?? 0, ms: payload.ms ?? 0 });
      } catch {
        // Ignore non-JSON messages.
      }
    }

    ws.addEventListener("message", onMessage);
  });

  try {
    ws.send(JSON.stringify({ event: "probe" }));
    const padding = new Uint8Array(PROBE_CHUNK_BYTES);
    for (let sent = 0; sent < PROBE_TOTAL_BYTES; sent += PROBE_CHUNK_BYTES) {
      if (ws.readyState !== WebSocket.OPEN) return null;
      ws.send(padding);
    }
    ws.send(JSON.stringify({ event: "probe_end" }));
  } catch {
    return null;
  }

  const result = await measured;
  if (!result || result.bytes <= 0 || result.ms < 2) return null;

  const bps = (result.bytes * 8) / (result.ms / 1000);
  // An absurdly low reading usually means the socket stalled for an unrelated
  // reason. A very fast one is not an error — half a megabyte really does cross
  // a good connection in a few milliseconds — it just means the payload was too
  // small to measure precisely, so it is treated as "comfortably fast" and the
  // caller's ceiling does the rest. An earlier 50ms floor rejected exactly that
  // case and quietly dropped every fast connection to the fallback rate.
  if (!Number.isFinite(bps) || bps < 50_000) return null;
  return Math.min(bps, 1_000_000_000);
}

export async function publishViaWebSocket(
  wsUrl: string,
  stream: MediaStream,
  options: PublishOptions,
): Promise<PublishHandle> {
  if (stream.getAudioTracks().length === 0) {
    throw new Error(
      "No microphone detected. Allow mic access in your browser settings.",
    );
  }

  const ws = await openWebSocket(wsUrl);
  const mimeType = pickRecorderMimeType();

  const measuredUplinkBps = await probeUplink(ws);
  const videoBitsPerSecond = measuredUplinkBps
    ? Math.min(
        MAX_VIDEO_BPS,
        Math.max(
          MIN_VIDEO_BPS,
          Math.round(measuredUplinkBps * UPLINK_UTILISATION) -
            AUDIO_BITS_PER_SECOND,
        ),
      )
    : FALLBACK_VIDEO_BPS;

  // The relay sizes its transcode from this, so it must be sent before any
  // media. Resolution in particular: x264 cannot change resolution once
  // running, so the relay pins a scaler to whatever we open at and every later
  // quality drop is scaled back up rather than killing the encoder.
  ws.send(
    JSON.stringify({
      event: "start",
      width: options.output.width,
      height: options.output.height,
      fps: options.output.fps,
      videoBitrate: videoBitsPerSecond,
      audioBitrate: AUDIO_BITS_PER_SECOND,
    }),
  );

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });

  // The browser is the one place none of this can be observed from the server,
  // and a broadcast that stops sending looks identical at the relay whether the
  // recorder died, the uplink stalled, or the operator closed the tab. Report
  // what happened so the relay log can tell them apart.
  const report = (event: string, data: Record<string, unknown> = {}) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ event: "client", at: Math.round(performance.now()), name: event, ...data }));
    } catch {
      // Diagnostics must never take the broadcast down with them.
    }
  };

  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() ?? {};
  report("recorder_start", {
    mimeType,
    requestedVideoBps: videoBitsPerSecond,
    measuredUplinkBps: measuredUplinkBps ? Math.round(measuredUplinkBps) : null,
    trackWidth: settings.width ?? null,
    trackHeight: settings.height ?? null,
    trackFps: settings.frameRate ?? null,
    manualCapture: options.manualCapture?.() ?? null,
  });

  const ceiling = backlogCeiling(videoBitsPerSecond);
  let bytesSent = 0;
  let chunksSent = 0;

  // Cheap heartbeat of what the recorder is actually producing versus what was
  // asked for — the gap between the two is the thing worth seeing.
  const statsTimer = window.setInterval(() => {
    report("stats", {
      buffered: ws.bufferedAmount,
      bytesSent,
      chunksSent,
      recorder: recorder.state,
      trackState: track?.readyState ?? null,
      shedLevel: options.shedLevel?.() ?? null,
      // The decisive pair: if frames keep being drawn while bytes stop moving,
      // the capture or the recorder is at fault, not the render loop.
      framesDrawn: options.framesDrawn?.() ?? null,
      hidden: document.hidden,
    });
  }, 5_000);

  // WebM over a socket is one continuous byte stream, so individual chunks can
  // never be dropped without corrupting it for the relay's demuxer. Watch the
  // send backlog instead: a sustained overrun means the uplink cannot carry the
  // broadcast at the current quality. Previously that ended the service outright
  // — a congregation lost the whole sermon to a passing bandwidth dip. Now it
  // sheds quality first, and only gives up if even the lowest rung cannot get
  // through for the better part of a minute.
  let overCeilingSince: number | null = null;
  let lastShedAt = 0;
  let exhausted = false;

  const backlogWatchdog = window.setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (ws.bufferedAmount <= ceiling) {
      overCeilingSince = null;
      return;
    }

    const now = performance.now();
    overCeilingSince ??= now;
    const backloggedFor = now - overCeilingSince;

    if (!exhausted && backloggedFor >= SHED_AFTER_MS && now - lastShedAt >= SHED_AFTER_MS) {
      lastShedAt = now;
      const shed = options.onCongestion?.() ?? false;
      report("shed", { shed, buffered: ws.bufferedAmount, backloggedForMs: Math.round(backloggedFor) });
      if (!shed) exhausted = true;
      // Give the lower rung a chance to drain before judging it again.
      overCeilingSince = now;
      return;
    }

    if (exhausted && backloggedFor >= FATAL_AFTER_MS) {
      report("fatal_backlog", { buffered: ws.bufferedAmount, bytesSent, chunksSent });
      options.onFatal?.(
        "Your internet upload speed cannot carry the broadcast, even at the " +
          "lowest quality. The stream was stopped.",
      );
      cleanup();
    }
  }, 1_000);

  const cleanup = () => {
    window.clearInterval(backlogWatchdog);
    window.clearInterval(statsTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    ws.close();
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size <= 0 || ws.readyState !== WebSocket.OPEN) return;

    bytesSent += event.data.size;
    chunksSent += 1;

    // A hidden tab throttles the recorder's timeslice timer as well as the
    // render loop, so returning to the page can flush minutes of accumulated
    // audio as one enormous blob. One such flush arrived as a 17 MB frame and
    // the relay closed the socket outright — 1009, message too big — killing a
    // broadcast that was otherwise healthy. Split before sending: the relay
    // concatenates into ffmpeg's stdin, so frame boundaries carry no meaning
    // and any split point is safe.
    if (event.data.size <= MAX_WS_MESSAGE_BYTES) {
      ws.send(event.data);
      return;
    }

    report("oversized_chunk", { size: event.data.size, parts: Math.ceil(event.data.size / MAX_WS_MESSAGE_BYTES) });
    for (let offset = 0; offset < event.data.size; offset += MAX_WS_MESSAGE_BYTES) {
      ws.send(event.data.slice(offset, offset + MAX_WS_MESSAGE_BYTES));
    }
  });

  recorder.addEventListener("error", (event) => {
    const err = (event as unknown as { error?: { name?: string; message?: string } }).error;
    report("recorder_error", { errorType: err?.name ? "recorder" : "unknown" });
    cleanup();
  });

  // A recorder that stops on its own — rather than because we stopped it — is
  // the signature of the track underneath it going away.
  recorder.addEventListener("stop", () => {
    report("recorder_stopped", { bytesSent, chunksSent, trackState: track?.readyState ?? null });
  });

  track?.addEventListener("ended", () => {
    report("track_ended", { bytesSent, chunksSent });
  });

  // Correlates a stall with the operator switching away. The render clock is
  // meant to survive that now; this is how we can tell whether it did, rather
  // than inferring it from a gap in the byte counts.
  const onVisibility = () => {
    report("visibility", { hidden: document.hidden, bytesSent, chunksSent });
  };
  document.addEventListener("visibilitychange", onVisibility);

  ws.addEventListener("close", (event) => {
    window.clearInterval(backlogWatchdog);
    window.clearInterval(statsTimer);
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    // Cannot be reported over the socket that just closed; left for the console.
    console.warn("[studio] ingest socket closed", {
      code: event.code,
      reason: event.reason,
      bytesSent,
      chunksSent,
    });
  });

  recorder.start(100);

  return { stop: cleanup, videoBitsPerSecond, measuredUplinkBps };
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
