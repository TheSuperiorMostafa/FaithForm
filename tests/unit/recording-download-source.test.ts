import assert from "node:assert/strict";
import test from "node:test";
import type { Source } from "mediabunny";

import { createRecordingSourceLoader } from "@/lib/stream/recording-download-source";
import { isUserFacingError } from "@/lib/errors/user-error";

const MIB = 1024 * 1024;
const settle = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };

test("one shared byte budget evicts old segments even while their Source objects remain strongly referenced", async () => {
  const requests: string[] = [];
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal, cacheBytes: 3 * MIB,
    fetchFn: async (resource, init) => {
      requests.push(String(resource));
      assert.equal(init?.credentials, "same-origin");
      return new Response(new Uint8Array(MIB));
    },
  });
  const retained: Source[] = [];
  try {
    for (let index = 0; index < 12; index++) {
      const source = loader.sourceForUrl(`https://faithform.test/${index}.m4s`);
      retained.push(source);
      assert.equal(await source.getSize(), MIB);
    }
    assert.equal(requests.length, 12);
    assert.equal(retained.length, 12, "the bound cannot depend on HLS/GC releasing old sources");
    await loader.sourceForUrl("https://faithform.test/11.m4s").getSize();
    assert.equal(requests.length, 12, "the latest fragment remains cached for efficient packet reads");
    await loader.sourceForUrl("https://faithform.test/0.m4s").getSize();
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
  const work = [0, 1, 2, 3].map(index => loader.sourceForUrl(`https://faithform.test/${index}.m4s`).getSize());
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
    await assert.rejects(loader.sourceForUrl("https://faithform.test/missing.m4s").getSize(), error => isUserFacingError(error));
    assert.equal(requests, 1);
  } finally { loader.dispose(); }
});

test("transient recording errors have only two retries", async () => {
  let requests = 0;
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async () => { requests++; return new Response("Unavailable", { status: 503 }); },
  });
  try {
    await assert.rejects(loader.sourceForUrl("https://faithform.test/busy.m4s").getSize());
    assert.equal(requests, 3);
  } finally { loader.dispose(); }
});

test("oversized assets are refused before their body is buffered", async () => {
  let canceled = false;
  const loader = createRecordingSourceLoader({ signal: new AbortController().signal,
    fetchFn: async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "Content-Length": String(64 * MIB + 1) } }),
  });
  try {
    await assert.rejects(loader.sourceForUrl("https://faithform.test/oversized.m4s").getSize(), error => isUserFacingError(error) && /too large/.test(error.message));
    assert.equal(canceled, true);
  } finally { loader.dispose(); }
});
