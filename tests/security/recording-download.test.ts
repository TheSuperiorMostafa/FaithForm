import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { after } from "node:test";
import ts from "typescript";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getRecordingDownload, recordingDownloadFilename } from "@/lib/stream/recording-download";
import { verifyRecordingPlaybackToken } from "@/lib/stream/recording-playback";

const churchId = "11111111-1111-4111-8111-111111111111";
const recordingId = "22222222-2222-4222-8222-222222222222";
const previousSecret = process.env.STREAM_PLAYBACK_SECRET;
process.env.STREAM_PLAYBACK_SECRET = "safe-recording-download-test-secret-over-32-characters";
after(() => { if (previousSecret === undefined) delete process.env.STREAM_PLAYBACK_SECRET; else process.env.STREAM_PLAYBACK_SECRET = previousSecret; });

function fixture() {
  const state = {
    row: { id: recordingId, church_id: churchId, title: "Sunday Service", status: "ready", source_kind: "file",
      storage_path: `relay/${churchId}/original.mov`, segment_count: 0, total_bytes: 5_000_000_000,
      mobile_rendition_verified_at: "2026-11-17T00:00:00Z", deleted_at: null } as Record<string, unknown> | null,
    databaseError: false, signingError: false, signed: [] as { key: string; ttl: number; options: unknown }[], reads: 0,
  };
  const client = {
    from(table: string) {
      assert.equal(table, "stream_recordings");
      const filters: Record<string, unknown> = {};
      return { select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; },
        is(key: string, value: unknown) { filters[key] = value; return this; }, async maybeSingle() {
          state.reads++;
          assert.deepEqual(filters, { id: recordingId, church_id: churchId, deleted_at: null });
          return { data: state.row, error: state.databaseError ? { message: "private database detail" } : null };
        } };
    },
    storage: { from(bucket: string) {
      assert.equal(bucket, "stream-recordings");
      return { async createSignedUrl(key: string, ttl: number, options: unknown) {
        state.signed.push({ key, ttl, options });
        return { data: state.signingError ? null : { signedUrl: "https://storage.example.test/signed-original?download=Sunday%20Service.mov" },
          error: state.signingError ? { message: "private storage detail" } : null };
      } };
    } },
  } as unknown as SupabaseClient;
  return { state, client, plan: () => getRecordingDownload(churchId, recordingId, client) };
}

test("uploaded videos download as the original format with storage attachment headers, without proxying GB files", async () => {
  const f = fixture();
  const result = await f.plan();
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.download, { kind: "file", filename: "Sunday Service.mov", url: "https://storage.example.test/signed-original?download=Sunday%20Service.mov" });
  assert.deepEqual(f.state.signed, [{ key: `relay/${churchId}/original.mov`, ttl: 3600, options: { download: "Sunday Service.mov" } }]);
});

test("livestream downloads use a church-bound staff capability and the full service instead of a playlist file", async () => {
  const f = fixture(); Object.assign(f.state.row!, { source_kind: "segments", segment_count: 900 });
  const result = await f.plan(); assert.equal(result.ok, true);
  if (result.ok && result.download.kind === "segments") {
    assert.equal(result.download.filename, "Sunday Service.mp4");
    assert.equal(result.download.totalBytes, 5_000_000_000);
    assert.match(result.download.playlistUrl, /\/full\.m3u8$/);
    const token = result.download.playlistUrl.split("/").at(-2)!;
    assert.deepEqual(verifyRecordingPlaybackToken(token, { recordingId }), { churchId, audience: "staff" });
    assert.equal(verifyRecordingPlaybackToken(token, { recordingId: churchId }), null);
  } else assert.fail("A segmented recording must receive a remux plan");
  assert.equal(f.state.signed.length, 0);
});

test("deleted, foreign, malformed paths and missing recordings cannot grant download access", async () => {
  for (const patch of [null, { church_id: "other-church" }, { deleted_at: "2026-11-17" },
    { storage_path: `relay/${churchId}/../other-church/service.mp4` }, { storage_path: "https://untrusted.example/video.mp4" }]) {
    const f = fixture(); if (patch === null) f.state.row = null; else Object.assign(f.state.row!, patch);
    const result = await f.plan(); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
    assert.equal(f.state.signed.length, 0);
  }
});

test("live, processing, failed and unverified segmented recordings never produce a partial download", async () => {
  for (const patch of [{ status: "recording" }, { status: "processing" }, { status: "failed" },
    { source_kind: "segments", segment_count: 0 }, { source_kind: "segments", segment_count: 10, mobile_rendition_verified_at: null }]) {
    const f = fixture(); Object.assign(f.state.row!, patch);
    const result = await f.plan(); assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
    assert.equal(f.state.signed.length, 0);
  }
});

test("database and storage failures stay recoverable and never expose private provider details", async () => {
  for (const failure of ["databaseError", "signingError"] as const) {
    const f = fixture(); f.state[failure] = true;
    const result = await f.plan(); assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.status, 503); assert.match(result.error, /try again/i); }
    assert.doesNotMatch(JSON.stringify(result), /private (database|storage) detail/);
  }
});

test("download filenames cannot contain paths, control characters or unsafe extensions", () => {
  const name = recordingDownloadFilename('../Sunday\r\nService: "Live"/Video', 'MOV');
  assert.doesNotMatch(name, /[\r\n/\\:"*?<>|]/);
  assert.match(name, /\.mov$/);
  assert.equal(recordingDownloadFilename(null, "../unsafe"), "Recording.mp4");
  assert.ok(Array.from(recordingDownloadFilename("😀".repeat(200), "mp4")).length <= 104);
});

test("the actual download route checks Live access before database reads and uses only its authenticated church", async () => {
  const f = fixture(); let allowed = false; let adminCalls = 0;
  const path = "app/api/stream/recordings/[id]/download/route.ts";
  const require = createRequire(resolve(path));
  const routeModule = { exports: {} as { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  const providers: Record<string, unknown> = {
    "@/lib/features/guard": { requireFeatureApi: async (feature: string) => {
      assert.equal(feature, "live_stream");
      return allowed ? { ok: true, access: { auth: { churchId } } } : { ok: false, response: NextResponse.json({ error: "Not permitted" }, { status: 403 }) };
    } },
    "@/lib/supabase/admin": { createAdminClient: () => { adminCalls++; return f.client; } },
    "@/lib/stream/recording-download": { getRecordingDownload },
  };
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function("require", "module", "exports", compiled)((name: string) => providers[name] ?? require(name), routeModule, routeModule.exports);
  const call = (id = recordingId) => routeModule.exports.GET(new Request("https://faithform.example.test/download"), { params: Promise.resolve({ id }) });
  assert.equal((await call()).status, 403); assert.equal(adminCalls, 0); assert.equal(f.state.reads, 0);
  allowed = true;
  assert.equal((await call("invalid-id")).status, 404); assert.equal(adminCalls, 0);
  const response = await call(); assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private.*no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await response.json()).kind, "file"); assert.equal(f.state.reads, 1);
});

test("livestream plans carry each segment's stored size, read only from this church's uploaded segments", async () => {
  const takeId = "33333333-3333-4333-8333-333333333333";
  const reads: { table: string; filters: Record<string, unknown> }[] = [];
  const recording = { id: recordingId, church_id: churchId, title: "Sunday Service", status: "ready", source_kind: "segments",
    storage_path: null, segment_count: 2, total_bytes: 9, mobile_rendition_verified_at: "2026-11-17T00:00:00Z", deleted_at: null };
  const tables: Record<string, unknown[]> = {
    stream_recording_segments: [{ id: "seg-a", take_id: takeId, byte_size: 4 }, { id: "seg-b", take_id: takeId, byte_size: null }],
    stream_recording_takes: [{ id: takeId, init_bytes: 1 }],
  };
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      reads.push({ table, filters });
      const query = {
        select() { return query; }, order() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        is(key: string, value: unknown) { filters[key] = value; return query; },
        in(key: string, value: unknown) { filters[key] = value; return Promise.resolve({ data: tables[table], error: null }); },
        range() { return Promise.resolve({ data: tables[table], error: null }); },
        async maybeSingle() { return { data: recording, error: null }; },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const result = await getRecordingDownload(churchId, recordingId, client);
  assert.equal(result.ok, true);
  if (result.ok && result.download.kind === "segments") {
    assert.deepEqual(result.download.assetBytes, { "seg/seg-a.m4s": 4, [`init/${takeId}.mp4`]: 1 },
      "a missing size is left for the browser to ask for, never guessed");
  } else assert.fail("expected a segments plan");
  assert.deepEqual(reads.find(read => read.table === "stream_recording_segments")?.filters,
    { recording_id: recordingId, church_id: churchId, status: "uploaded" });
  assert.equal(reads.find(read => read.table === "stream_recording_takes")?.filters.church_id, churchId);
});
