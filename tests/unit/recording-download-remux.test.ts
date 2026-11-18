import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { BufferSource, BufferTarget, EncodedPacketSink, Input, MP4 } from "mediabunny";

import { prepareRecordingDownload, remuxRecordingToMp4, type RecordingAsset } from "@/lib/stream/download-recording";
import { isUserFacingError } from "@/lib/errors/user-error";

const root = path.join(process.cwd(), "tests/fixtures/recording/download-hls");
const base = "https://faithform.test/recording/index.m3u8";
const standard = `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1.000,\n000000.m4s\n#EXTINF:1.000,\n000001.m4s\n#EXT-X-ENDLIST\n`;
const reconnect = standard.replace("#EXT-X-ENDLIST", `#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI="take2-init.mp4"\n#EXTINF:1.000,\ntake2-000000.m4s\n#EXTINF:1.000,\ntake2-000001.m4s\n#EXT-X-ENDLIST`);
const fileBytes = (url: string) => readFile(path.join(root, path.basename(new URL(url).pathname).replace(/^take2-/, "")));
const assetFor = (url: string): RecordingAsset => ({
  size: async () => (await fileBytes(url)).byteLength,
  read: async (start, end) => new Uint8Array((await fileBytes(url)).subarray(start, end)),
});
const stalled = (): RecordingAsset => ({ size: () => new Promise<number>(() => {}), read: async () => new Uint8Array() });

async function exportFile(playlistText: string) {
  const target = new BufferTarget();
  const progress: number[] = [];
  await remuxRecordingToMp4({ playlistText, playlistUrl: base, assetFor, target, signal: new AbortController().signal, onProgress: p => progress.push(p) });
  assert.ok(target.buffer);
  return { bytes: new Uint8Array(target.buffer), progress };
}

async function inspect(bytes: Uint8Array) {
  const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
  try {
    const tracks = [];
    for (const track of await input.getTracks()) {
      const hashes: string[] = [];
      for await (const packet of new EncodedPacketSink(track).packets()) hashes.push(createHash("sha256").update(packet.data).digest("hex"));
      tracks.push({ type: track.type, codec: await track.getCodec(), duration: await track.computeDuration(), hashes });
    }
    return tracks;
  } finally { input.dispose(); }
}

test("real H.264/AAC fragments become a playable MP4 with both tracks and monotonic progress", async () => {
  const { bytes, progress } = await exportFile(standard);
  const tracks = await inspect(bytes);
  assert.deepEqual(tracks.map(track => [track.type, track.codec]), [["video", "avc"], ["audio", "aac"]]);
  assert.equal(tracks[0].hashes.length, 24);
  assert.ok(tracks[1].hashes.length >= 94);
  assert.ok(tracks.every(track => Math.abs(track.duration - 2) < 0.05));
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((value, index) => !index || value >= progress[index - 1]));
});

test("an encoder reconnect with its own init and reset timestamps preserves every encoded video and audio packet", async () => {
  const single = await inspect((await exportFile(standard)).bytes);
  const joined = await inspect((await exportFile(reconnect)).bytes);
  assert.equal(joined.length, 2);
  for (let index = 0; index < joined.length; index++) {
    assert.deepEqual(joined[index].hashes, [...single[index].hashes, ...single[index].hashes], "copy mode must not transcode or drop packets at the AAC priming overlap");
    assert.ok(Math.abs(joined[index].duration - 4) < 0.1);
  }
  assert.ok(Math.abs(joined[0].duration - joined[1].duration) < 0.05, "reconnect shifts must preserve audio/video synchronization");
});

test("a discontinuity inside one take also preserves all available packets", async () => {
  const single = await inspect((await exportFile(standard)).bytes);
  const discontinuous = standard.replace("#EXTINF:1.000,\n000001.m4s", "#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1.000,\n000001.m4s");
  const joined = await inspect((await exportFile(discontinuous)).bytes);
  for (let index = 0; index < joined.length; index++) assert.deepEqual(joined[index].hashes, single[index].hashes);
});

test("a changed encoder configuration is refused before producing a partial recording", async () => {
  const playlistText = standard.replace("#EXT-X-ENDLIST", `#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI="changed-init.mp4"\n#EXTINF:1.000,\nchanged-000000.m4s\n#EXT-X-ENDLIST`);
  const target = new BufferTarget();
  await assert.rejects(remuxRecordingToMp4({ playlistText, playlistUrl: base, assetFor, target, signal: new AbortController().signal, onProgress: () => {} }), error => isUserFacingError(error) && /changed video or audio formats/.test(error.message));
  assert.equal(target.buffer, null);
});

test("a missing fragment fails instead of silently producing a shortened download", async () => {
  await assert.rejects(exportFile(standard.replace("000001.m4s", "missing.m4s")));
});

test("cancellation stops an unreadable source promptly and the next download can succeed", async () => {
  const controller = new AbortController();
  const pending = remuxRecordingToMp4({
    playlistText: standard, playlistUrl: base, target: new BufferTarget(), signal: controller.signal, onProgress: () => {},
    assetFor: () => {
      setImmediate(() => controller.abort());
      return stalled();
    },
  });
  await assert.rejects(pending, error => error instanceof DOMException && error.name === "AbortError");
  assert.ok((await exportFile(standard)).bytes.length > 0);
});

test("a stalled media source has a bounded failure even if its read never rejects", async () => {
  const started = Date.now();
  await assert.rejects(remuxRecordingToMp4({
    playlistText: standard, playlistUrl: base, target: new BufferTarget(), signal: new AbortController().signal, onProgress: () => {}, idleMs: 20,
    assetFor: stalled,
  }), error => isUserFacingError(error) && /stopped responding/.test(error.message));
  assert.ok(Date.now() - started < 1000);
});

function browser(t: TestContext, storage?: unknown) {
  for (const [name, value] of Object.entries({ window: { location: { href: "https://faithform.test/dashboard/live-streaming/recordings" } }, navigator: { storage } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
  }
}

function mockNetwork(t: TestContext) {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    assert.equal(init?.credentials, "same-origin");
    const url = new URL(resource instanceof Request ? resource.url : resource.toString());
    const name = path.basename(url.pathname);
    const bytes = name === "index.m3u8" ? new TextEncoder().encode(standard) : new Uint8Array(await readFile(path.join(root, name)));
    const range = new Headers(init?.headers).get("range");
    if (range) {
      const [, startValue, endValue] = /^bytes=(\d+)-(\d*)$/.exec(range)!;
      const start = Number(startValue), end = Math.min(endValue ? Number(endValue) : bytes.length - 1, bytes.length - 1);
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Accept-Ranges": "bytes" } });
    }
    return new Response(bytes, { headers: { "Content-Length": String(bytes.length), "Accept-Ranges": "bytes" } });
  });
  return requests;
}

test("the browser export reads through authenticated same-origin routes without exposing storage credentials", async t => {
  browser(t);
  const requests = mockNetwork(t);
  const result = await prepareRecordingDownload({ playlistUrl: base, totalBytes: 100_000, signal: new AbortController().signal, onProgress: () => {} });
  const tracks = await inspect(new Uint8Array(await result.file.arrayBuffer()));
  assert.equal(tracks.length, 2);
  assert.ok(requests.length > 2);
  await result.release();
});

test("large exports use writable disk storage and release it only when the caller is finished", async t => {
  let data = new Uint8Array(0);
  const removed: string[] = [];
  let opened = 0;
  const writable = new WritableStream<{ data: Uint8Array; position: number }>({
    write(chunk) {
      if (data.length < chunk.position + chunk.data.length) {
        const next = new Uint8Array(chunk.position + chunk.data.length); next.set(data); data = next;
      }
      data.set(chunk.data, chunk.position);
    },
  });
  browser(t, { getDirectory: async () => ({
    getFileHandle: async () => ({ createWritable: async () => { opened++; return writable; }, getFile: async () => new File([data], "service.mp4", { type: "video/mp4" }) }),
    removeEntry: async (name: string) => { removed.push(name); },
  }) });
  mockNetwork(t);
  const result = await prepareRecordingDownload({ playlistUrl: base, totalBytes: 3 * 1024 ** 3, signal: new AbortController().signal, onProgress: () => {} });
  assert.equal(opened, 1);
  assert.equal(removed.length, 0, "the backing file must stay available during the browser's save operation");
  assert.equal((await inspect(new Uint8Array(await result.file.arrayBuffer()))).length, 2);
  await result.release(); await result.release();
  assert.equal(removed.length, 1);
  assert.match(removed[0], /^faithform-download-/);
});

test("a cancelled large preparation removes its temporary disk file", async t => {
  const controller = new AbortController();
  let abortedWrites = 0, removed = 0;
  browser(t, { getDirectory: async () => ({
    getFileHandle: async () => ({ createWritable: async () => ({ abort: async () => { abortedWrites++; } }) }),
    removeEntry: async () => { removed++; },
  }) });
  t.mock.method(globalThis, "fetch", async () => { controller.abort(); return new Response(standard); });
  await assert.rejects(prepareRecordingDownload({ playlistUrl: base, totalBytes: 3 * 1024 ** 3, signal: controller.signal, onProgress: () => {} }), error => error instanceof DOMException && error.name === "AbortError");
  assert.equal(abortedWrites, 1);
  assert.equal(removed, 1);
});

test("large exports fail clearly before fetching when writable disk storage is unavailable", async t => {
  browser(t, { getDirectory: async () => { throw new Error("unsupported"); } });
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not allocate a GB buffer"); });
  await assert.rejects(prepareRecordingDownload({ playlistUrl: base, totalBytes: 3 * 1024 ** 3, signal: new AbortController().signal, onProgress: () => {} }), error => isUserFacingError(error) && /make room/.test(error.message));
  assert.equal(network.mock.callCount(), 0);
});

test("a playlist without Content-Length is still bounded while reading its body", async t => {
  browser(t);
  let chunks = 0, canceled = false;
  const network = t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 ** 2)); },
    cancel() { canceled = true; },
  })));
  await assert.rejects(prepareRecordingDownload({ playlistUrl: base, totalBytes: 100_000, signal: new AbortController().signal, onProgress: () => {} }), error => isUserFacingError(error));
  assert.equal(canceled, true);
  assert.ok(chunks <= 6, "the body cannot keep accumulating before the parser sees it");
  assert.equal(network.mock.callCount(), 1);
});
