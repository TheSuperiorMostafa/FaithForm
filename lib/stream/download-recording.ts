import {
  BufferTarget, CustomSource, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, MP4,
  Mp4OutputFormat, Output, QTFF, StreamTarget, type EncodedPacket, type InputAudioTrack, type InputVideoTrack, type Target,
} from "mediabunny";

import { isUserFacingError, UserFacingError } from "@/lib/errors/user-error";
import { createRecordingSourceLoader, type RecordingAsset } from "@/lib/stream/recording-download-source";

const MIB = 1024 * 1024;
const MAX_BUFFER_BYTES = 128 * MIB;
const MAX_PLAYLIST_BYTES = 4 * MIB;
const IDLE_MS = 90_000;
const SCRATCH_PREFIX = "faithform-download-";

type PlaylistSegment = { url: string; duration: number };
type PlaylistPart = { init: string; segments: PlaylistSegment[] };
export type PreparedRecordingDownload = { file: Blob; release: () => Promise<void> };
export type { RecordingAsset };

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

function codecIdentity(config: VideoDecoderConfig | AudioDecoderConfig | null): string {
  return JSON.stringify(config, (_key, value: unknown) => {
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return value;
  });
}

/**
 * One take as the fragmented MP4 it really is: its init segment followed by
 * its media segments, byte for byte. Read this way the demuxer keeps each
 * fragment's own timestamps. Reading the takes as HLS instead re-times every
 * segment from the playlist, which pulls audio that runs past a segment's
 * video (our encoder's audio leads by up to two seconds) backwards in time,
 * and the MP4 writer then refuses the whole export.
 */
function takeSource(urls: string[], assetFor: (url: string) => RecordingAsset): CustomSource {
  let layout: Promise<number[]> | null = null;
  const offsets = () => layout ??= (async () => {
    const sizes: number[] = new Array(urls.length);
    let next = 0;
    // A few requests at a time: one per asset, and only the size.
    await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
      while (next < urls.length) {
        const index = next++;
        sizes[index] = await assetFor(urls[index]).size();
      }
    }));
    const starts = [0];
    for (const size of sizes) starts.push(starts[starts.length - 1] + size);
    return starts;
  })();
  return new CustomSource({
    getSize: async () => (await offsets()).at(-1)!,
    read: async (start, end) => {
      const starts = await offsets();
      const out = new Uint8Array(end - start);
      let position = start;
      let index = 0;
      while (index < urls.length - 1 && starts[index + 1] <= position) index++;
      while (position < end && index < urls.length) {
        const local = position - starts[index];
        const take = Math.min(end, starts[index + 1]) - position;
        if (take > 0) {
          out.set(await assetFor(urls[index]).read(local, local + take), position - start);
          position += take;
        }
        index++;
      }
      return out;
    },
    maxCacheSize: 0,
    handleUnhandledError: () => {},
  });
}

/**
 * The MP4 muxer refuses a packet presented before anything in the previous GOP.
 * A healthy encoder never does that, but one dropping frames under load can
 * (seen in real FaithForm recordings, which then could not be downloaded at
 * all). Such a frame is shown at the GOP boundary instead: one late frame,
 * nothing dropped. Packets from a healthy recording pass through unchanged.
 */
export function gopGuard() {
  let max = -Infinity;
  let floor = -Infinity;
  return (timestamp: number, key: boolean) => {
    if (key) floor = max;
    const safe = Math.max(timestamp, floor);
    max = Math.max(max, safe);
    return safe;
  };
}

/**
 * Copies every encoded packet of every take into one standard MP4, in order,
 * without transcoding. Each take keeps its own timing; a later take (an encoder
 * reconnect, which restarts its clock) is placed right after the one before.
 */
export async function remuxRecordingToMp4(options: {
  playlistText: string;
  playlistUrl: string;
  assetFor: (url: string) => RecordingAsset;
  target: Target;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
  idleMs?: number;
}): Promise<void> {
  if (options.signal.aborted) throw aborted();
  const parts = playlistParts(options.playlistText, options.playlistUrl);
  const totalDuration = parts.reduce((sum, part) => sum + part.segments.reduce((total, segment) => total + segment.duration, 0), 0) || 1;
  const active = new Set<Input>();
  let output: Output | undefined;
  let cancellation: Promise<void> | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopPromise = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const cancelWork = () => {
    if (output && output.state !== "finalized" && output.state !== "canceled") {
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
  const openTake = (part: PlaylistPart) => {
    const input = new Input({
      source: takeSource([part.init, ...part.segments.map(segment => segment.url)], options.assetFor),
      formats: [MP4, QTFF],
    });
    active.add(input);
    return input;
  };
  const closeTake = (input: Input) => { input.dispose(); active.delete(input); };
  const mediaTracks = async (input: Input) => {
    const tracks = await input.getTracks();
    if (!tracks.some(track => track.isVideoTrack())) throw new Error("Recording has no video track");
    for (const track of tracks) {
      if (!track.isVideoTrack() && !track.isAudioTrack()) {
        throw new UserFacingError("We couldn't keep every part of this recording in the download. Contact FaithForm support.");
      }
    }
    // Video first, then audio, so every take lines its tracks up the same way.
    return (tracks as (InputVideoTrack | InputAudioTrack)[])
      .sort((a, b) => Number(b.isVideoTrack()) - Number(a.isVideoTrack()));
  };
  const identity = async (tracks: (InputVideoTrack | InputAudioTrack)[]) =>
    Promise.all(tracks.map(async track => `${track.type}:${codecIdentity(await track.getDecoderConfig())}`));

  options.signal.addEventListener("abort", onAbort, { once: true });
  progress(0);

  try {
    await Promise.race([(async () => {
      // Every take must carry the same streams before anything is written, so
      // a changed encoder is refused rather than half-exported.
      let reference: string[] | null = null;
      for (let index = 0; index < parts.length; index++) {
        const probe = openTake(parts[index]);
        try {
          const identities = await identity(await mediaTracks(probe));
          if (reference && JSON.stringify(reference) !== JSON.stringify(identities)) {
            throw new UserFacingError("This service changed video or audio formats while recording. Contact FaithForm support for a downloadable copy.");
          }
          reference ??= identities;
        } finally { closeTake(probe); }
        if (stopped || options.signal.aborted) throw aborted();
        progress(0.05 * (index + 1) / parts.length);
      }

      output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: options.target });
      let sources: (EncodedVideoPacketSource | EncodedAudioPacketSource)[] | null = null;
      // The muxer needs each track's decoder configuration with its first packet.
      const configured = new Set<number>();
      const guards = new Map<number, ReturnType<typeof gopGuard>>();
      let offset = 0;
      let written = 0;

      for (const part of parts) {
        const input = openTake(part);
        try {
          const tracks = await mediaTracks(input);
          if (!sources) {
            sources = [];
            for (const track of tracks) {
              const codec = await track.getCodec();
              if (!codec) throw new UserFacingError("We couldn't keep all the video and sound in this download. Contact FaithForm support.");
              if (track.isVideoTrack()) {
                const source = new EncodedVideoPacketSource(codec as ConstructorParameters<typeof EncodedVideoPacketSource>[0]);
                output.addVideoTrack(source);
                sources.push(source);
              } else {
                const source = new EncodedAudioPacketSource(codec as ConstructorParameters<typeof EncodedAudioPacketSource>[0]);
                output.addAudioTrack(source);
                sources.push(source);
              }
            }
            await output.start();
          }
          const configs = await Promise.all(tracks.map(track => track.getDecoderConfig()));
          const streams = tracks.map((track, index) => ({
            index,
            packets: new EncodedPacketSink(track).packets(),
            next: null as EncodedPacket | null,
          }));
          for (const stream of streams) {
            const result = await stream.packets.next();
            stream.next = result.done ? null : result.value;
          }
          const takeStart = Math.min(...streams.filter(stream => stream.next).map(stream => stream.next!.timestamp));
          let takeEnd = offset;
          // Interleave by time, as the tracks were recorded.
          for (;;) {
            if (stopped || options.signal.aborted) throw aborted();
            let chosen: (typeof streams)[number] | null = null;
            for (const stream of streams) {
              if (stream.next && (!chosen || stream.next.timestamp < chosen.next!.timestamp)) chosen = stream;
            }
            if (!chosen) break;
            const packet = chosen.next!;
            let guard = guards.get(chosen.index);
            if (!guard) guards.set(chosen.index, guard = gopGuard());
            const timestamp = guard(packet.timestamp - takeStart + offset, packet.type === "key");
            const moved = packet.clone({ timestamp });
            const source = sources[chosen.index];
            const meta = configured.has(chosen.index)
              ? undefined
              : { decoderConfig: configs[chosen.index] ?? undefined };
            configured.add(chosen.index);
            if (source instanceof EncodedVideoPacketSource) {
              await source.add(moved, meta as EncodedVideoChunkMetadata | undefined);
            } else {
              await source.add(moved, meta as EncodedAudioChunkMetadata | undefined);
            }
            takeEnd = Math.max(takeEnd, timestamp + packet.duration);
            if (++written % 64 === 0) progress(0.05 + 0.95 * Math.min(1, timestamp / totalDuration));
            const result = await chosen.packets.next();
            chosen.next = result.done ? null : result.value;
          }
          // The next take starts after every track of this one has ended.
          offset = takeEnd + 1e-6;
        } finally { closeTake(input); }
      }
      if (!written) throw new Error("Recording has no media packets");
      if (stopped || options.signal.aborted) throw aborted();
      await output.finalize();
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
      assetFor: sources.assetFor,
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
    // The cause stays in the console for support; the church sees plain words.
    console.error("[recording download] export failed", error);
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
