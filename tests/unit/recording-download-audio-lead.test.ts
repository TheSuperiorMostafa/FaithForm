import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { BufferSource, BufferTarget, EncodedPacketSink, Input, MP4 } from "mediabunny";

import { remuxRecordingToMp4, type RecordingAsset } from "@/lib/stream/download-recording";

// FaithForm's encoder cuts fragments on video keyframes, and each fragment's
// audio runs past its video (by ~1.9 s in production; 0.6 s here). Reading the
// take as HLS re-timed each fragment from the playlist and moved that audio
// backwards, which the MP4 writer refused: "Timestamps cannot be smaller than
// the largest timestamp of the previous GOP". Built from the shared H.264/AAC
// fixture by re-fragmenting it with the audio fed 0.6 s ahead of the video.
const root = path.join(process.cwd(), "tests/fixtures/recording/download-hls-audio-lead");
const base = "https://faithform.test/recording/index.m3u8";
const bytes = (url: string) => readFile(path.join(root, path.basename(new URL(url).pathname)));
const assetFor = (url: string): RecordingAsset => ({
  size: async () => (await bytes(url)).byteLength,
  read: async (start, end) => new Uint8Array((await bytes(url)).subarray(start, end)),
});

test("fragments whose audio runs ahead of their video export with every packet, in time", async () => {
  const target = new BufferTarget();
  await remuxRecordingToMp4({
    playlistText: await readFile(path.join(root, "index.m3u8"), "utf8"), playlistUrl: base, assetFor, target,
    signal: new AbortController().signal, onProgress: () => {},
  });
  const input = new Input({ source: new BufferSource(new Uint8Array(target.buffer!)), formats: [MP4] });
  try {
    const result: Record<string, { packets: number; duration: number }> = {};
    for (const track of await input.getTracks()) {
      let packets = 0;
      for await (const _packet of new EncodedPacketSink(track).packets()) packets++;
      result[track.type] = { packets, duration: await track.computeDuration() };
    }
    assert.equal(result.video.packets, 72, "three copies of the 24-frame clip");
    assert.ok(result.audio.packets >= 280);
    assert.ok(Math.abs(result.video.duration - result.audio.duration) < 0.1, "audio and video stay in step");
    assert.ok(result.video.duration > 5.9 && result.video.duration < 6.2);
  } finally { input.dispose(); }
});
