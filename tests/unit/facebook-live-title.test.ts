import test from "node:test";
import assert from "node:assert/strict";

import { provisionFacebookLiveRtmpUrl } from "@/lib/integrations/facebook-live";

test("Facebook live posts use the service title for both title and visible description", async () => {
  const originalFetch = globalThis.fetch;
  let request: Request | undefined;

  globalThis.fetch = (async (input, init) => {
    request = new Request(input, init);
    return new Response(
      JSON.stringify({ id: "live-video", secure_stream_url: "rtmps://facebook/live" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await provisionFacebookLiveRtmpUrl(
      "page-id",
      "page-token",
      "Sunday Morning Worship",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(request);
  const body = new URLSearchParams(await request!.clone().text());
  assert.equal(body.get("title"), "Sunday Morning Worship");
  assert.equal(body.get("description"), "Sunday Morning Worship");
});
