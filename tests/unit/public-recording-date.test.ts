import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PublicRecordingPage from "@/app/live/[slug]/watch/[id]/page";

Object.assign(globalThis, { React });
const churchId = "11111111-1111-4111-8111-111111111111";
const recordingId = "22222222-2222-4222-8222-222222222222";

test("the public player uses the same church-local date as its website sermon feed", async t => {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://recording-date.example.test", SUPABASE_SECRET_KEY: "safe-test-key" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let timezone = "America/New_York";
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    assert.equal(url.hostname, "recording-date.example.test");
    if (url.pathname.endsWith("/churches")) {
      assert.equal(url.searchParams.get("slug"), "eq.qa-recording-date");
      assert.ok(url.searchParams.get("select")?.split(",").map(s => s.trim()).includes("timezone"));
      return Response.json({ id: churchId, name: "QA Church", slug: "qa-recording-date", timezone });
    }
    if (url.pathname.endsWith("/rpc/web_recordings")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { p_church_slug: "qa-recording-date", p_recording_id: recordingId, p_limit: 1 });
      return Response.json([{ id: recordingId, church_id: churchId, title: "Evening service", recorded_at: "2026-11-13T03:11:00Z", duration_sec: 6, source_kind: "file", storage_path: "qa.mp4", listed: true }]);
    }
    assert.equal(url.pathname, "/storage/v1/object/sign/stream-recordings/qa.mp4");
    return Response.json({ signedURL: "/object/sign/stream-recordings/qa.mp4?token=safe-test-token" });
  });
  for (const [zone, expected, unexpected] of [["America/New_York", "Nov 12, 2026", "Nov 13, 2026"], ["Asia/Tokyo", "Nov 13, 2026", "Nov 12, 2026"]]) {
    timezone = zone;
    const page = await PublicRecordingPage({ params: Promise.resolve({ slug: "qa-recording-date", id: recordingId }) });
    const html = renderToStaticMarkup(page);
    assert.ok(html.includes(expected), zone);
    assert.ok(!html.includes(unexpected), zone);
    assert.ok(html.includes("Evening service"));
  }
});
