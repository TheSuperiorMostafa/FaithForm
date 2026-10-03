import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/stream/recordings/[id]/[...rest]/route";
import { signRecordingPlaybackToken, verifyRecordingPlaybackToken } from "@/lib/stream/recording-playback";
import { getWebRecording } from "@/lib/stream/web-recordings";

const recordingId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";

test("published file issuance yields a recording-bound public route, never a signed storage URL", async () => {
  const originalSecret = process.env.STREAM_PLAYBACK_SECRET;
  process.env.STREAM_PLAYBACK_SECRET = "unit-test-public-recording-secret-material";
  try {
    const client = { async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "web_recordings");
      assert.equal(args.p_recording_id, recordingId);
      return { data: [{ id: recordingId, church_id: "church-a", title: "Service", source_kind: "file",
        storage_path: "relay/church-a/service.mp4", recorded_at: "2026-10-03", listed: true }], error: null };
    } } as unknown as SupabaseClient;
    const found = await getWebRecording("church-a", recordingId, client);
    assert.equal(found?.playback?.kind, "progressive");
    const url = found!.playback!.url;
    assert.match(url, /^\/api\/stream\/recordings\//);
    assert.ok(url.endsWith("/file.mp4"));
    assert.doesNotMatch(url, /storage|service\.mp4/);
    const token = url.split("/")[5];
    assert.deepEqual(verifyRecordingPlaybackToken(token, { recordingId }), { churchId: "church-a", audience: "public" });
    assert.equal(verifyRecordingPlaybackToken(token, { recordingId: otherId }), null);
  } finally {
    if (originalSecret === undefined) delete process.env.STREAM_PLAYBACK_SECRET;
    else process.env.STREAM_PLAYBACK_SECRET = originalSecret;
  }
});

test("file route rejects malformed, expired, wrong-recording and staff capabilities before accessing storage", async () => {
  const originalSecret = process.env.STREAM_PLAYBACK_SECRET;
  process.env.STREAM_PLAYBACK_SECRET = "unit-test-public-recording-secret-material";
  try {
    const tokens: Array<[string, number]> = [
      ["malformed", 401],
      [signRecordingPlaybackToken({ churchId: "church-a", recordingId: otherId, audience: "public" })!, 401],
      [signRecordingPlaybackToken({ churchId: "church-a", recordingId, audience: "public", nowSeconds: 0 })!, 401],
      [signRecordingPlaybackToken({ churchId: "church-a", recordingId, audience: "staff" })!, 403],
    ];
    for (const [token, expectedStatus] of tokens) {
      const response = await GET(new NextRequest("https://faithform.invalid/file.mp4"), {
        params: Promise.resolve({ id: recordingId, rest: [token, "file.mp4"] }),
      });
      assert.equal(response.status, expectedStatus);
    }
  } finally {
    if (originalSecret === undefined) delete process.env.STREAM_PLAYBACK_SECRET;
    else process.env.STREAM_PLAYBACK_SECRET = originalSecret;
  }
});
