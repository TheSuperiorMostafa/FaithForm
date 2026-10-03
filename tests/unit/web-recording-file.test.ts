import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { webRecordingFileResponse } from "@/lib/stream/web-recording-file";

const churchId = "church-a";
const recordingId = "recording-a";
const storagePath = "relay/church-a/service.mp4";

function fixture() {
  let published = true;
  let publicationError = false;
  let owner = churchId;
  let path = storagePath;
  let upstreamEtag = '"verified"';
  let upstreamStatus = 206;
  let verifiedEtag: string | null = '"verified"';
  let verifiedSize: number | null = 100;
  let signedCalls = 0;
  let fetchCalls = 0;
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const query = {
        select() { return this; },
        eq(key: string, value: unknown) { filters[key] = value; return this; },
        async maybeSingle() {
          assert.equal(filters.id, table === "churches" ? churchId : recordingId);
          if (table === "churches") return { data: { slug: "church-a" }, error: null };
          assert.equal(filters.church_id, churchId);
          return { data: {
            storage_path: path, mobile_rendition_object_etag: verifiedEtag,
            mobile_rendition_object_version: null, mobile_rendition_object_size: verifiedSize,
          }, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      assert.equal(name, "web_recordings");
      assert.equal(params.p_church_slug, "church-a");
      assert.equal(params.p_recording_id, recordingId);
      return { data: published ? [{ id: recordingId, church_id: owner, source_kind: "file", storage_path: path }] : [],
        error: publicationError ? new Error("private database detail") : null };
    },
    storage: { from(bucket: string) {
      assert.equal(bucket, "stream-recordings");
      return { async createSignedUrl(key: string, ttl: number) {
        signedCalls++;
        assert.equal(key, storagePath);
        assert.equal(ttl, 60);
        return { data: { signedUrl: "https://storage.invalid/private-token" }, error: null };
      } };
    } },
  } as unknown as SupabaseClient;
  const fetcher: typeof fetch = async (url, options) => {
    fetchCalls++;
    assert.equal(url, "https://storage.invalid/private-token");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("range"), "bytes=0-2");
    assert.equal(headers.get("if-match"), verifiedEtag);
    assert.equal(options?.cache, "no-store");
    return new Response("abc", { status: upstreamStatus, headers: {
      etag: upstreamEtag, "content-type": "video/mp4", "content-range": "bytes 0-2/100", "content-length": "3",
    } });
  };
  const serve = () => webRecordingFileResponse({
    request: new Request("https://faithform.invalid/file.mp4", { headers: { Range: "bytes=0-2" } }),
    churchId, recordingId, client, fetcher,
  });
  return { serve, setPublished(value: boolean) { published = value; },
    setPublicationError() { publicationError = true; }, setOwner(value: string) { owner = value; },
    setPath(value: string) { path = value; }, setEtag(value: string) { upstreamEtag = value; },
    setStatus(value: number) { upstreamStatus = value; },
    setIdentity(etag: string | null, size: number | null) { verifiedEtag = etag; verifiedSize = size; },
    calls: () => ({ signedCalls, fetchCalls }) };
}

test("public progressive delivery proxies ranges without exposing the provider URL", async () => {
  const f = fixture();
  const response = await f.serve();
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-2/100");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("location"), null);
  assert.equal(await response.text(), "abc");
});

test("a previously playable public file is refused immediately after unpublishing", async () => {
  const f = fixture();
  assert.equal((await f.serve()).status, 206);
  f.setPublished(false);
  assert.equal((await f.serve()).status, 403);
  assert.deepEqual(f.calls(), { signedCalls: 1, fetchCalls: 1 });
});

test("publication lookup failure cannot authorize public file bytes", async () => {
  const f = fixture();
  f.setPublicationError();
  const response = await f.serve();
  assert.equal(response.status, 403);
  assert.doesNotMatch(await response.text(), /private database detail/);
  assert.deepEqual(f.calls(), { signedCalls: 0, fetchCalls: 0 });
});

test("cross-church RPC results never grant file access", async () => {
  const f = fixture();
  f.setOwner("church-b");
  assert.equal((await f.serve()).status, 403);
  assert.deepEqual(f.calls(), { signedCalls: 0, fetchCalls: 0 });
});

test("a stored path escaping the recording's church is refused", async () => {
  const f = fixture();
  f.setPath("relay/church-a/../church-b/service.mp4");
  assert.equal((await f.serve()).status, 403);
  assert.deepEqual(f.calls(), { signedCalls: 0, fetchCalls: 0 });
});

test("replacement object bytes are refused even if storage ignores If-Match", async () => {
  const f = fixture();
  f.setEtag('"replacement"');
  assert.equal((await f.serve()).status, 403);
});

test("a purportedly published legacy file without any verified object identity fails closed", async () => {
  const f = fixture();
  f.setIdentity(null, null);
  assert.equal((await f.serve()).status, 403);
  assert.deepEqual(f.calls(), { signedCalls: 0, fetchCalls: 0 });
});

test("a published legacy file with only verified size remains playable without ETag or version", async () => {
  const f = fixture();
  f.setIdentity(null, 100);
  assert.equal((await f.serve()).status, 206);
  assert.deepEqual(f.calls(), { signedCalls: 1, fetchCalls: 1 });
});

test("unsatisfiable ranges retain 416 and Content-Range without forwarding storage error bodies", async () => {
  const f = fixture();
  f.setStatus(416);
  const response = await f.serve();
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("content-range"), "bytes 0-2/100");
  assert.equal(await response.text(), "");
});
