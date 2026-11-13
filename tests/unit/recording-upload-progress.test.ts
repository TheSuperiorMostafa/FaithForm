import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { uploadRecordingWithProgress, type RecordingTransferProgress } from "@/lib/stream/upload-recording-browser";
import { RecordingUploadProgress } from "@/components/live-streaming/recordings/recording-upload-progress";

const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function transport(t: TestContext) {
  const requests: FakeXHR[] = [];
  class FakeXHR {
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 200;
    statusText = "OK";
    responseText = JSON.stringify({ Key: "stream-recordings/relay/qa/upload-test.mp4" });
    headers = new Headers();
    method = "";
    url = "";
    body: unknown;
    open(method: string, url: string) { this.method = method; this.url = url; requests.push(this); }
    setRequestHeader(key: string, value: string) { this.headers.set(key, value); }
    getAllResponseHeaders() { return "content-type: application/json\r\n"; }
    send(body: unknown) { this.body = body; }
    report(loaded: number, total: number, lengthComputable = true) { this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, value: FakeXHR });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "XMLHttpRequest", previous); else Reflect.deleteProperty(globalThis, "XMLHttpRequest"); });
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://recording-upload.example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "safe-public-test-key" })) {
    const original = process.env[key]; process.env[key] = value;
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
  t.mock.method(globalThis, "fetch", async () => { throw new Error("The upload must use its measured XHR transport."); });
  const progress: RecordingTransferProgress[] = [];
  const upload = () => uploadRecordingWithProgress({
    path: "relay/qa/upload-test.mp4", token: "synthetic-signed-token", video: new Blob(["safe-video"], { type: "video/mp4" }),
    onProgress: value => progress.push(value),
  });
  return { requests, progress, upload };
}

test("real SDK signed uploads retain endpoint, token, headers and multipart body while reporting actual transfer bytes", async t => {
  const h = transport(t), result = h.upload(); await settle(); const xhr = h.requests[0];
  assert.ok(xhr); assert.equal(xhr.method, "PUT");
  const url = new URL(xhr.url);
  assert.equal(url.origin, "https://recording-upload.example.test");
  assert.equal(url.pathname, "/storage/v1/object/upload/sign/stream-recordings/relay/qa/upload-test.mp4");
  assert.equal(url.searchParams.get("token"), "synthetic-signed-token");
  assert.equal(xhr.headers.get("x-upsert"), "false");
  assert.equal(xhr.headers.get("apikey"), "safe-public-test-key");
  assert.equal(xhr.headers.has("content-type"), false, "the browser supplies its multipart boundary");
  assert.ok(xhr.body instanceof FormData); assert.equal(xhr.body.get("cacheControl"), "3600");
  assert.equal((xhr.body.get("") as File).size, 10);
  xhr.report(250, 1000); xhr.report(700, 1000); xhr.report(300, 1000);
  assert.deepEqual(h.progress.at(-1), { loaded: 700, total: 1000 }, "late events cannot move the bar backwards");
  xhr.report(500, 0, false); xhr.report(NaN, 1000); assert.equal(h.progress.at(-1)?.loaded, 700);
  xhr.onload?.(); assert.equal((await result).error, null);
  assert.deepEqual(h.progress.at(-1), { loaded: 1000, total: 1000 });
});

test("a refused upload preserves its last measured bytes and returns the Storage failure instead of invented completion", async t => {
  const h = transport(t), result = h.upload(); await settle(); const xhr = h.requests[0];
  xhr.report(400, 1000); xhr.status = 413; xhr.statusText = "Payload Too Large";
  xhr.responseText = JSON.stringify({ statusCode: "413", error: "EntityTooLarge", message: "Too large" });
  xhr.onload?.(); const response = await result;
  assert.ok(response.error); assert.equal("status" in response.error ? response.error.status : null, 413);
  assert.deepEqual(h.progress.at(-1), { loaded: 400, total: 1000 });
  assert.equal(h.requests.length, 1, "failed transfers are retried only when the user chooses");
});

test("connection loss rejects the SDK upload and retains measurable progress for retry", async t => {
  const h = transport(t), result = h.upload(); await settle(); const xhr = h.requests[0];
  xhr.report(600, 1000); xhr.onerror?.();
  assert.ok((await result).error); assert.deepEqual(h.progress.at(-1), { loaded: 600, total: 1000 });
});

test("progress view exposes the correct percentage, sent and remaining amounts and the active upload stage", () => {
  const html = renderToStaticMarkup(createElement(RecordingUploadProgress, {
    phase: "uploading", filename: "qa.mp4", loaded: 15_000_000, total: 60_000_000, originalBytes: 60_000_000, optimization: null, error: null,
  }));
  assert.match(html, /role="progressbar"/); assert.match(html, /aria-valuenow="25"/);
  assert.match(html, /15.0 MB uploaded/); assert.match(html, /45.0 MB.*remaining/);
  assert.match(html, /aria-current="step"[^>]*>.*?Upload<\/span>/);
  assert.doesNotMatch(html, /Video uploaded/);
});

test("an interrupted transfer keeps its real counts and recovery, while final checks clearly follow the upload", () => {
  const props = { filename: "qa.mp4", loaded: 400, total: 1000, originalBytes: 1000, optimization: null };
  const failed = renderToStaticMarkup(createElement(RecordingUploadProgress, { ...props, phase: "uploading", error: "Connection lost. Try again." }));
  assert.match(failed, /Upload interrupted/); assert.match(failed, /aria-valuenow="40"/);
  assert.match(failed, /400 bytes uploaded/); assert.match(failed, /600 bytes.*remaining/); assert.match(failed, /role="alert"/);
  const checking = renderToStaticMarkup(createElement(RecordingUploadProgress, { ...props, phase: "checking", error: "Try checking again." }));
  assert.match(checking, /Video uploaded/); assert.match(checking, /aria-valuenow="100"/);
  assert.match(checking, /Finish upload/); assert.match(checking, /0 bytes.*remaining/);
  const preparing = renderToStaticMarkup(createElement(RecordingUploadProgress, { ...props, phase: "preparing", error: null }));
  assert.doesNotMatch(preparing, /aria-valuenow|bytes uploaded/);
  const invalid = renderToStaticMarkup(createElement(RecordingUploadProgress, { ...props, phase: "preparing", error: "We couldn't read this video." }));
  assert.match(invalid, /Choose another MP4 video, then try again/);
  assert.doesNotMatch(invalid, /Reading the video|animate-spin/);
});
