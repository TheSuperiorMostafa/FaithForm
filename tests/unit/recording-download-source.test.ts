import assert from "node:assert/strict";
import test from "node:test";

import { createRecordingSourceLoader, type RecordingAsset } from "@/lib/stream/recording-download-source";
import { isUserFacingError } from "@/lib/errors/user-error";

const MIB = 1024 * 1024;
const settle = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };

test("one shared byte budget evicts old segments even while their asset handles remain strongly referenced", async () => {
  const requests: string[] = [];
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal, cacheBytes: 3 * MIB,
    fetchFn: async (resource, init) => {
      requests.push(String(resource));
      assert.equal(init?.credentials, "same-origin");
      return new Response(new Uint8Array(MIB));
    },
  });
  const retained: RecordingAsset[] = [];
  try {
    for (let index = 0; index < 12; index++) {
      const asset = loader.assetFor(`https://faithform.test/${index}.m4s`);
      retained.push(asset);
      assert.equal((await asset.read(0, MIB)).length, MIB);
    }
    assert.equal(requests.length, 12);
    assert.equal(retained.length, 12, "the bound cannot depend on garbage collection releasing old handles");
    await loader.assetFor("https://faithform.test/11.m4s").read(0, 1);
    assert.equal(requests.length, 12, "the latest fragment remains cached for efficient packet reads");
    await loader.assetFor("https://faithform.test/0.m4s").read(0, 1);
    assert.equal(requests.length, 13, "an old source cannot retain its whole fragment outside the shared LRU");
  } finally { loader.dispose(); }
});

test("at most two asset downloads run together and cancellation also releases queued work", async () => {
  const controller = new AbortController();
  let running = 0, peak = 0, requests = 0;
  const loader = createRecordingSourceLoader({ signal: controller.signal,
    fetchFn: async (_resource, init) => {
      requests++; running++; peak = Math.max(peak, running);
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => { running--; reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
      });
    },
  });
  const work = [0, 1, 2, 3].map(index => loader.assetFor(`https://faithform.test/${index}.m4s`).read(0, 1));
  const completed = Promise.allSettled(work);
  await settle();
  assert.equal(requests, 2);
  assert.equal(peak, 2);
  controller.abort();
  assert.ok((await completed).every(result => result.status === "rejected" && result.reason instanceof DOMException && result.reason.name === "AbortError"));
  assert.equal(running, 0);
  assert.equal(requests, 2, "canceled queue entries must never start a request");
  loader.dispose();
});

test("missing/auth-denied recording assets fail once without retrying a permanent refusal", async () => {
  let requests = 0;
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async () => { requests++; return new Response("Unavailable", { status: 404 }); },
  });
  try {
    await assert.rejects(loader.assetFor("https://faithform.test/missing.m4s").read(0, 1), error => isUserFacingError(error));
    assert.equal(requests, 1);
  } finally { loader.dispose(); }
});

test("transient recording errors have only two retries", async () => {
  let requests = 0;
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async () => { requests++; return new Response("Unavailable", { status: 503 }); },
  });
  try {
    await assert.rejects(loader.assetFor("https://faithform.test/busy.m4s").read(0, 1));
    assert.equal(requests, 3);
  } finally { loader.dispose(); }
});

test("oversized assets are refused before their body is buffered", async () => {
  let canceled = false;
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "Content-Length": String(64 * MIB + 1) } }),
  });
  try {
    await assert.rejects(loader.assetFor("https://faithform.test/oversized.m4s").read(0, 1), error => isUserFacingError(error) && /too large/.test(error.message));
    assert.equal(canceled, true);
  } finally { loader.dispose(); }
});

test("a take's layout uses HEAD sizes without downloading the segment bodies", async () => {
  const methods: string[] = [];
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async (_resource, init) => {
      methods.push(init?.method ?? "GET");
      assert.equal(init?.credentials, "same-origin");
      return init?.method === "HEAD"
        ? new Response(null, { headers: { "Content-Length": String(5 * MIB) } })
        : new Response(new Uint8Array(5 * MIB));
    },
  });
  try {
    assert.equal(await loader.assetFor("https://faithform.test/a.m4s").size(), 5 * MIB);
    assert.equal(await loader.assetFor("https://faithform.test/a.m4s").size(), 5 * MIB);
    assert.deepEqual(methods, ["HEAD"], "the size is asked for once and no body is fetched");
  } finally { loader.dispose(); }
});

test("stored sizes lay a take out without a request per segment, and a mismatched file is refused", async () => {
  const methods: string[] = [];
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    knownSizes: { "seg/a.m4s": 4, "seg/b.m4s": 5 },
    fetchFn: async (_resource, init) => {
      methods.push(init?.method ?? "GET");
      return new Response(new Uint8Array(4), { headers: { "content-length": "4" } });
    },
  });
  try {
    assert.equal(await loader.assetFor("https://faithform.test/api/stream/recordings/r/t/seg/a.m4s").size(), 4);
    assert.equal(await loader.assetFor("https://faithform.test/api/stream/recordings/r/t/seg/b.m4s").size(), 5);
    assert.deepEqual(methods, [], "known sizes must not cost a request");
    assert.equal(await loader.assetFor("https://faithform.test/api/stream/recordings/r/t/seg/c.m4s").size(), 4);
    assert.deepEqual(methods, ["HEAD"], "an unknown size still falls back to asking");
    assert.equal((await loader.assetFor("https://faithform.test/api/stream/recordings/r/t/seg/a.m4s").read(0, 4)).length, 4);
    await assert.rejects(
      loader.assetFor("https://faithform.test/api/stream/recordings/r/t/seg/b.m4s").read(0, 4),
      (error: unknown) => isUserFacingError(error),
    );
  } finally { loader.dispose(); }
});
