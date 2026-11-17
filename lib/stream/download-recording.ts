import {
  BufferSource, BufferTarget, Conversion, CustomPathedSource, HLS_FORMATS, Input,
  Mp4OutputFormat, Output, StreamTarget, type Source, type Target,
} from "mediabunny";

import { isUserFacingError, UserFacingError } from "@/lib/errors/user-error";
import { createRecordingSourceLoader } from "@/lib/stream/recording-download-source";

const MIB = 1024 * 1024;
const MAX_BUFFER_BYTES = 128 * MIB;
const MAX_PLAYLIST_BYTES = 4 * MIB;
const IDLE_MS = 90_000;
const SCRATCH_PREFIX = "faithform-download-";

type PlaylistSegment = { url: string; duration: number };
type PlaylistPart = { init: string; segments: PlaylistSegment[] };
export type PreparedRecordingDownload = { file: Blob; release: () => Promise<void> };

function aborted(): DOMException {
  return new DOMException("Download cancelled", "AbortError");
}

function recordingUrl(path: string, base: string): string {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin || !["https:", "http:"].includes(url.protocol)) {
    throw new UserFacingError("We couldn't read this recording. Refresh the page and try again.");
  }
  return url.href;
}

/** Only FaithForm's finite, unencrypted fMP4 media playlists are accepted. */
function playlistParts(text: string, base: string): PlaylistPart[] {
  if (text.length > MAX_PLAYLIST_BYTES || !text.startsWith("#EXTM3U") || !text.includes("#EXT-X-ENDLIST")) {
    throw new UserFacingError("This recording is still being saved. Try downloading it again when it is ready.");
  }
  const parts: PlaylistPart[] = [];
  let init: string | null = null;
  let duration: number | null = null;
  let boundary = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXT-X-(STREAM-INF|MEDIA:|KEY:|BYTERANGE:)/.test(line)) {
      throw new UserFacingError("This recording can't be downloaded in this format. Contact FaithForm support.");
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const path = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(line)?.[1];
      if (!path) throw new Error("Invalid recording initialization path");
      const next = recordingUrl(path, base);
      if (init !== next) boundary = true;
      init = next;
    } else if (line === "#EXT-X-DISCONTINUITY") {
      boundary = true;
    } else if (line.startsWith("#EXTINF:")) {
      duration = Number(line.slice(8).split(",")[0]);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error("Invalid recording segment duration");
    } else if (!line.startsWith("#")) {
      if (!init || duration === null) throw new Error("Missing recording segment metadata");
      if (boundary) { parts.push({ init, segments: [] }); boundary = false; }
      parts[parts.length - 1].segments.push({ url: recordingUrl(line, base), duration });
      duration = null;
    }
  }
  if (!parts.length || duration !== null) throw new Error("Empty or unfinished recording playlist");
  return parts;
}

function manifest(parts: PlaylistPart[]): string {
  const longest = Math.max(...parts.flatMap(part => part.segments.map(segment => segment.duration)));
  const lines = ["#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${Math.ceil(longest)}`, "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-MEDIA-SEQUENCE:0"];
  parts.forEach((part, index) => {
    if (index) lines.push("#EXT-X-DISCONTINUITY");
    lines.push(`#EXT-X-MAP:URI="${part.init}"`);
    for (const segment of part.segments) lines.push(`#EXTINF:${segment.duration.toFixed(6)},`, segment.url);
  });
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

function codecIdentity(config: VideoDecoderConfig | AudioDecoderConfig | null): string {
  return JSON.stringify(config, (_key, value: unknown) => {
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return value;
  });
}

/**
 * The small media-only core also lets tests use real local HLS fragments.
 * The caller owns the target; this function never needs WebCodecs or transcodes.
 */
export async function remuxRecordingToMp4(options: {
  playlistText: string;
  playlistUrl: string;
  sourceForUrl: (url: string) => Source;
  target: Target;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  idleMs?: number;
}): Promise<void> {
  if (options.signal.aborted) throw aborted();
  const parts = playlistParts(options.playlistText, options.playlistUrl);
  const active = new Set<Input>();
  let conversion: Conversion | undefined;
  let output: Output | undefined;
  let cancellation: Promise<void> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopPromise = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const cancelWork = () => {
    if (conversion) {
      if (conversion.state !== "done" && conversion.state !== "canceled") cancellation ??= conversion.cancel().catch(() => {});
    } else if (output && output.state !== "finalized" && output.state !== "canceled") {
      cancellation ??= output.cancel().catch(() => {});
    }
  };
  const stop = (error: Error) => {
    if (stopped) return;
    stopped = true;
    for (const input of active) input.dispose();
    cancelWork();
    rejectStop(error);
  };
  const onAbort = () => stop(aborted());
  const progress = (fraction: number) => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => stop(new UserFacingError("The recording download stopped responding. Check your connection and try again.")), options.idleMs ?? IDLE_MS);
    options.onProgress(Math.max(0, Math.min(1, fraction)));
  };
  const makeInput = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const input = new Input({
      source: new CustomPathedSource(options.playlistUrl, request => request.isRoot
        ? new BufferSource(bytes)
        : options.sourceForUrl(recordingUrl(request.path, options.playlistUrl))),
      formats: HLS_FORMATS,
      formatOptions: { hls: { offsetTimestampsByDateTime: false } },
    });
    active.add(input);
    return input;
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  progress(0);

  try {
    await Promise.race([(async () => {
      let reference: string[] | null = null;
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        const probe = makeInput(manifest([part]));
        try {
          const tracks = await probe.getTracks();
          if (!tracks.some(track => track.isVideoTrack())) throw new Error("Recording has no video track");
          const identities = await Promise.all(tracks.map(async track => {
            if (!track.isVideoTrack() && !track.isAudioTrack()) {
              throw new UserFacingError("We couldn't keep every part of this recording in the download. Contact FaithForm support.");
            }
            return `${track.type}:${codecIdentity(await track.getDecoderConfig())}`;
          }));
          identities.sort();
          if (reference && JSON.stringify(reference) !== JSON.stringify(identities)) {
            throw new UserFacingError("This service changed video or audio formats while recording. Contact FaithForm support for a downloadable copy.");
          }
          reference ??= identities;
          if (index < parts.length - 1) {
            const actualEnd = await probe.computeDuration();
            const declaredEnd = part.segments.reduce((sum, segment) => sum + segment.duration, 0);
            // Encoder reconnects can overlap by an AAC priming packet. Keep
            // every packet and shift the next whole take equally for A/V.
            // This avoids the pinned muxer's backwards-timestamp rejection.
            if (!Number.isFinite(actualEnd) || actualEnd < 0) throw new Error("Invalid recording media duration");
            const padding = Math.max(0, actualEnd - declaredEnd);
            if (padding > 0) part.segments[part.segments.length - 1].duration += padding + 0.000001;
          }
        } finally {
          probe.dispose();
          active.delete(probe);
        }
        if (stopped || options.signal.aborted) throw aborted();
        progress(0.05 * (index + 1) / parts.length);
      }
      const input = makeInput(manifest(parts));
      output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: options.target });
      conversion = await Conversion.init({
        input, output, tracks: "all",
        copy: { mode: "forced", shiftTolerance: Infinity },
        showWarnings: false,
      });
      if (!conversion.isValid || conversion.discardedTracks.length > 0) {
        throw new UserFacingError("We couldn't keep all the video and sound in this download. Contact FaithForm support.");
      }
      conversion.onProgress = fraction => progress(0.05 + 0.95 * fraction);
      if (stopped || options.signal.aborted) throw aborted();
      await conversion.execute();
      if (stopped || options.signal.aborted) throw aborted();
      progress(1);
    })(), stopPromise]);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", onAbort);
    for (const input of active) input.dispose();
    cancelWork();
    // A canceled StreamTarget closes its writable. Let that finish before the
    // caller removes the temporary file, without hanging on a broken writer.
    if (cancellation) await new Promise<void>(resolve => {
      const cleanupTimer = setTimeout(resolve, 2000);
      void cancellation!.then(() => { clearTimeout(cleanupTimer); resolve(); });
    });
  }
}

async function openScratchFile() {
  const directory = await navigator.storage.getDirectory();
  const iterable = directory as FileSystemDirectoryHandle & { entries?: () => AsyncIterable<[string, FileSystemHandle]> };
  // A closed tab cannot finish delayed cleanup. Remove only abandoned files
  // from this export feature, never uploads or any other origin-private data.
  if (iterable.entries) {
    try {
      for await (const [name] of iterable.entries()) {
        const created = /^faithform-download-(\d{13})-[a-f0-9-]+\.mp4$/.exec(name)?.[1];
        if (created && Date.now() - Number(created) > 24 * 60 * 60_000) await directory.removeEntry(name).catch(() => {});
      }
    } catch { /* Cleanup is best effort; a current export can still proceed. */ }
  }
  const name = `${SCRATCH_PREFIX}${Date.now()}-${crypto.randomUUID()}.mp4`;
  const handle = await directory.getFileHandle(name, { create: true });
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await directory.removeEntry(name).catch(() => {});
  };
  try {
    return { handle, writable: await handle.createWritable(), release };
  } catch (error) {
    await release();
    throw error;
  }
}

/** Prepare a same-quality MP4, using disk rather than GBs of browser memory. */
export async function prepareRecordingDownload(options: {
  playlistUrl: string;
  totalBytes: number;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<PreparedRecordingDownload> {
  if (options.signal.aborted) throw aborted();
  if (!Number.isSafeInteger(options.totalBytes) || options.totalBytes <= 0) {
    throw new UserFacingError("This recording is still being saved. Refresh the page and try again.");
  }
  const playlistUrl = recordingUrl(options.playlistUrl, window.location.href);
  let scratch: Awaited<ReturnType<typeof openScratchFile>> | undefined;
  let sources: ReturnType<typeof createRecordingSourceLoader> | undefined;
  let keep = false;
  const request = new AbortController();
  const onAbort = () => request.abort();
  options.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => request.abort(), IDLE_MS);
  try {
    if (options.totalBytes > MAX_BUFFER_BYTES) {
      try { scratch = await openScratchFile(); }
      catch { throw new UserFacingError("Your browser couldn't make room for this recording. Free some space, or try an updated browser."); }
    }
    const response = await fetch(playlistUrl, { credentials: "same-origin", cache: "no-store", signal: request.signal });
    if (!response.ok) throw new UserFacingError("We couldn't open this recording for download. Refresh the page and try again.");
    if (Number(response.headers.get("content-length")) > MAX_PLAYLIST_BYTES) throw new Error("Recording playlist is too large");
    if (!response.body) throw new Error("Recording playlist has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let playlistBytes = 0;
    let playlistText = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        playlistBytes += value.byteLength;
        if (playlistBytes > MAX_PLAYLIST_BYTES) {
          await reader.cancel();
          throw new Error("Recording playlist is too large");
        }
        playlistText += decoder.decode(value, { stream: true });
      }
      playlistText += decoder.decode();
    } finally { reader.releaseLock(); }
    clearTimeout(timeout);
    if (options.signal.aborted) throw aborted();
    const target = scratch ? new StreamTarget(scratch.writable, { chunked: true, chunkSize: 4 * MIB }) : new BufferTarget();
    sources = createRecordingSourceLoader({ signal: options.signal });
    await remuxRecordingToMp4({
      playlistText, playlistUrl, target, signal: options.signal, onProgress: options.onProgress,
      sourceForUrl: sources.sourceForUrl,
    });
    const file = target instanceof BufferTarget
      ? target.buffer && new Blob([target.buffer], { type: "video/mp4" })
      : await scratch?.handle.getFile();
    if (!file || file.size === 0) throw new Error("Empty exported recording");
    if (options.signal.aborted) throw aborted();
    keep = true;
    return { file, release: scratch?.release ?? (async () => {}) };
  } catch (error) {
    if (options.signal.aborted) throw aborted();
    if (isUserFacingError(error)) throw error;
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new UserFacingError("There isn't enough free space to prepare this recording. Free some space and try again.");
    }
    throw new UserFacingError("We couldn't prepare this recording for download. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", onAbort);
    request.abort();
    sources?.dispose();
    if (scratch && !keep) {
      await scratch.writable.abort().catch(() => {});
      await scratch.release();
    }
  }
}
