import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { probeRecording } from "@/lib/media/v1/rendition-check";
import { assessRendition, MAX_CONTAINER_BOX_BYTES } from "@/lib/media/v1/rendition";

const MIB = 1024 * 1024;
const init = readFileSync("tests/fixtures/recording/init-h264-aac.mp4");
const fileTypeSize = init.readUInt32BE(0);
const fileType = init.subarray(0, fileTypeSize);

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, payload]);
}

function longRecording(fastStart: boolean): Buffer {
  const index = box("moov", Buffer.concat([
    init.subarray(fileTypeSize + 8),
    box("free", Buffer.alloc(5 * MIB)),
  ]));
  const media = box("mdat", Buffer.alloc(10 * MIB));
  return Buffer.concat([fileType, ...(fastStart ? [index, media] : [media, index])]);
}

const storage = {
  storage: {
    from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "https://storage.invalid/recording" }, error: null }),
    }),
  },
} as unknown as SupabaseClient;

for (const fastStart of [true, false]) {
  test(`the probe verifies a large ${fastStart ? "front" : "trailing"} MP4 index using bounded ranges`, async (t) => {
    const file = longRecording(fastStart);
    assert.equal(assessRendition(file.subarray(0, MIB), file.subarray(-4 * MIB)).reason, "index_not_found");
    const ranges: number[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
      const range = new Headers(options.headers).get("range")!;
      const [, startText, endText] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
      const start = Number(startText);
      const end = Math.min(Number(endText), file.length - 1);
      const bytes = file.subarray(start, end + 1);
      ranges.push(bytes.length);
      return new Response(new Uint8Array(bytes), {
        status: 206,
        headers: { "content-range": `bytes ${start}-${end}/${file.length}`, etag: '"original"' },
      });
    });

    const result = await probeRecording("recording.mp4", storage);
    assert.equal(result.verdict.playable, true);
    assert.equal(result.verdict.reason, "ok");
    assert.equal(result.identity.sizeBytes, file.length);
    assert.match(result.identity.windowHash!, /^[a-f0-9]{64}$/);
    assert.equal(ranges.length, fastStart ? 2 : 3);
    assert.ok(ranges.every((size) => size <= MIB + MAX_CONTAINER_BOX_BYTES));
  });
}

test("an object replaced while expanding the index is refused", async (t) => {
  const file = longRecording(true);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const [, endText] = /bytes=0-(\d+)/.exec(new Headers(options.headers).get("range")!)!;
    const end = Number(endText);
    requests += 1;
    return new Response(new Uint8Array(file.subarray(0, end + 1)), {
      status: 206,
      headers: {
        "content-range": `bytes 0-${end}/${file.length}`,
        etag: requests === 1 ? '"original"' : '"replacement"',
      },
    });
  });

  const result = await probeRecording("recording.mp4", storage);
  assert.equal(result.verdict.playable, false);
  assert.equal(result.verdict.reason, "object_changed");
  assert.equal(result.identity.windowHash, null);
});

test("a small valid recording still needs only one range request", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(init), {
    status: 206,
    headers: { "content-range": `bytes 0-${init.length - 1}/${init.length}`, etag: '"original"' },
  }));
  const result = await probeRecording("recording.mp4", storage);
  assert.equal(result.verdict.playable, true);
  assert.equal(fetch.mock.callCount(), 1);
});
