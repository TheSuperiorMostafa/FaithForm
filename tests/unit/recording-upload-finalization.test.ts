import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeUploadedRecording, recheckFileRecording } from "@/lib/stream/recording-upload-service";

test("uploaded MP4 verification retries without re-uploading and never reports an unsaved verdict as completed", async t => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.test"; process.env.SUPABASE_SECRET_KEY = "test-secret";
  t.after(() => {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.key;
  });
  const bytes = readFileSync("tests/fixtures/recording/init-h264-aac.mp4");
  const input = { churchId: "church-a", recordingId: "recording-a" };
  let status = "processing", storedSize = bytes.length, failVerification = true, deleted = false, missing = false, storagePath = `relay/${input.churchId}/upload-${input.recordingId}.mp4`;
  let readyWrites = 0, verifications = 0, storageReads = 0;
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    if (url.pathname.endsWith("/stream_recordings")) {
      assert.equal(url.searchParams.get("church_id"), `eq.${input.churchId}`);
      if (options?.method === "PATCH") {
        readyWrites++; status = "ready";
        assert.equal(url.searchParams.get("status"), "eq.processing");
        return Response.json({ id: input.recordingId });
      }
      return Response.json(missing ? null : { status, total_bytes: bytes.length, deleted_at: deleted ? "2026-11-01" : null, source_kind: "file", storage_path: storagePath });
    }
    if (url.pathname.includes("/object/info/")) { storageReads++; return Response.json({ size: storedSize }); }
    if (url.pathname.includes("/object/sign/") && options?.method === "POST") return Response.json({ signedURL: "/object/sign/stream-recordings/video?token=local-test" });
    if (url.pathname.includes("/object/sign/")) return new Response(new Uint8Array(bytes), { status: 206, headers: { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`, etag: '"uploaded"' } });
    if (url.pathname.endsWith("/record_recording_rendition")) {
      verifications++;
      const body = JSON.parse(String(options?.body));
      assert.equal(body.p_church_id, input.churchId);
      assert.equal(body.p_recording_id, input.recordingId);
      assert.equal(body.p_playable, true);
      assert.match(body.p_object_hash, /^[a-f0-9]{64}$/);
      return failVerification ? Response.json({ code: "unavailable", message: "injected write failure" }, { status: 503 }) : Response.json([{ ok: true, playable: true, revision: 1 }]);
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const db = createAdminClient();
  const first = await finalizeUploadedRecording(input, db);
  assert.equal(first.ok, false);
  if (!first.ok) assert.match(first.error, /will not upload again/);
  assert.equal(readyWrites, 1);
  failVerification = false;
  assert.equal((await finalizeUploadedRecording(input, db)).ok, true);
  assert.equal(readyWrites, 1, "a finalize retry must not restart or duplicate the upload");
  assert.equal(verifications, 2);
  assert.equal((await recheckFileRecording(input, db)).ok, true);
  storedSize--;
  assert.equal((await finalizeUploadedRecording(input, db)).ok, false);
  assert.equal(verifications, 3, "an incomplete upload must not receive a verdict");
  assert.equal(storageReads, 3);
  deleted = true;
  assert.equal((await finalizeUploadedRecording(input, db)).ok, false);
  assert.equal((await recheckFileRecording(input, db)).ok, false);
  deleted = false; missing = true;
  assert.equal((await finalizeUploadedRecording(input, db)).ok, false);
  assert.equal((await recheckFileRecording(input, db)).ok, false);
  missing = false; storagePath = "relay/church-b/other.mp4";
  assert.equal((await recheckFileRecording(input, db)).ok, false);
  assert.equal(verifications, 3, "deleted, missing and foreign storage targets never get reverified");
});
