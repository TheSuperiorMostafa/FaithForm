import { BlobSource, BufferTarget, Conversion, Input, MP4, Mp4OutputFormat, Output, Quality, StreamTarget } from "mediabunny";

import { assessRendition } from "@/lib/media/v1/rendition";

const MIB = 1024 * 1024;
const MAX_BUFFER_BYTES = 128 * MIB;
const MIN_SAVINGS = 0.1;
const ENCODE_IDLE_MS = 20_000;

type OptimizedRecording = { file: Blob; release: () => Promise<void> };

async function openScratchFile() {
  const directory = await navigator.storage.getDirectory();
  const name = `faithform-recording-${crypto.randomUUID()}.mp4`;
  const handle = await directory.getFileHandle(name, { create: true });
  const release = () => directory.removeEntry(name).catch(() => {});
  try {
    return { handle, writable: await handle.createWritable(), release };
  } catch (error) {
    await release();
    throw error;
  }
}

/** Best-effort encoding. The caller can always upload the untouched original. */
export async function optimizeRecording(
  file: File,
  durationSec: number,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
): Promise<OptimizedRecording | null> {
  if (typeof VideoEncoder === "undefined" || signal.aborted) return null;

  const input = new Input({ source: new BlobSource(file), formats: [MP4] });
  let scratch: Awaited<ReturnType<typeof openScratchFile>> | undefined;
  let keepScratch = false;
  let conversion: Conversion | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  let cancellation: Promise<void> | undefined;

  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return null;
    const [width, height, stats, hdr] = await Promise.all([
      video.getDisplayWidth(),
      video.getDisplayHeight(),
      video.computePacketStats(240),
      video.hasHighDynamicRange(),
    ]);
    // Leave HDR grading intact. This AVC encode is for standard-range video.
    if (hdr) return null;
    const fps = stats.averagePacketRate || 30;
    // Leave already-efficient files alone. Keep the source dimensions and frame
    // rate, with a bitrate floor that scales with both for text and fine detail.
    const sourceBitrate = Math.min(stats.averageBitrate, file.size * 8 / durationSec);
    const targetBitrate = Math.round(Math.max(sourceBitrate * 0.75, width * height * fps * 0.07));
    if (!Number.isFinite(targetBitrate) || targetBitrate >= sourceBitrate * (1 - MIN_SAVINGS) || signal.aborted) {
      return null;
    }

    // Larger services use a temporary file so encoded data does not build up
    // in RAM. Older browsers can still optimize smaller recordings in memory.
    if (file.size > MAX_BUFFER_BYTES) {
      scratch = await openScratchFile();
    }
    const target = scratch ? new StreamTarget(scratch.writable, { chunked: true }) : new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target,
    });
    // Safari 27.0 and 27.0.1 can stall on AVC Main/High. Baseline keeps
    // quality-mode encoding working without permitting dropped frames.
    const affectedSafari = /\bVersion\/27\.0(?:\.[01])?(?:\s|$)/.test(navigator.userAgent);
    if (affectedSafari && (width * height * fps > 1920 * 1080 * 60 || targetBitrate > 50_000_000)) {
      return null;
    }
    conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: "avc",
        quality: new Quality({ bitrate: targetBitrate, bitrateMode: "variable" }),
        fullCodecString: affectedSafari ? "avc1.42002a" : undefined,
      },
      // Matching AAC tracks are copied, preserving their original audio.
      audio: { codec: "aac" },
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length > 0 || signal.aborted) return null;

    const encoding = conversion;
    const stopped = new Promise<false>((resolve) => {
      cancel = () => {
        cancellation ??= encoding.cancel().catch(() => {});
        resolve(false);
      };
    });
    const report = (progress: number) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(cancel!, ENCODE_IDLE_MS);
      onProgress(progress);
    };
    conversion.onProgress = report;
    signal.addEventListener("abort", cancel!, { once: true });
    report(0);
    const completed = await Promise.race([conversion.execute().then(() => true), stopped]);
    clearTimeout(idleTimer);
    if (!completed || signal.aborted) return null;

    const result = target instanceof BufferTarget
      ? target.buffer && new Blob([target.buffer], { type: "video/mp4" })
      : await scratch?.handle.getFile();
    if (!result || result.size === 0 || result.size > file.size * (1 - MIN_SAVINGS)) return null;

    // Apply the same format and codec checks used before publishing. A format
    // the browser can encode may still be outside the mobile playback profile.
    const head = new Uint8Array(await result.slice(0, MIB).arrayBuffer());
    let verdict = assessRendition(head);
    if (verdict.reason === "index_not_found" && result.size > head.length) {
      const tail = new Uint8Array(await result.slice(-4 * MIB).arrayBuffer());
      verdict = assessRendition(head, tail);
    }
    if (!verdict.playable || signal.aborted) return null;

    const optimized = new Input({ source: new BlobSource(result), formats: [MP4] });
    try {
      const outputVideo = await optimized.getPrimaryVideoTrack();
      if (!outputVideo) return null;
      const [outputWidth, outputHeight, outputDuration] = await Promise.all([
        outputVideo.getDisplayWidth(),
        outputVideo.getDisplayHeight(),
        optimized.getDurationFromMetadata(),
      ]);
      if (outputWidth !== width || outputHeight !== height ||
          outputDuration === null || Math.abs(outputDuration - durationSec) > 0.25 || signal.aborted) {
        return null;
      }
    } finally {
      optimized.dispose();
    }

    keepScratch = true;
    return { file: result, release: scratch?.release ?? (async () => {}) };
  } catch {
    return null;
  } finally {
    clearTimeout(idleTimer);
    if (cancel) signal.removeEventListener("abort", cancel);
    if (conversion?.state === "executing") await conversion.cancel().catch(() => {});
    input.dispose();
    await cancellation;
    if (scratch && !keepScratch) {
      await scratch.writable.abort().catch(() => {});
      await scratch.release();
    }
  }
}
