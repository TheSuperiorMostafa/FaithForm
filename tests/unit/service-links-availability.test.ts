import assert from "node:assert/strict";
import test from "node:test";
import { getLiveMedia } from "@/lib/media/v1/media-service";
import { getLinkedPresentation, getLinkedServices } from "@/lib/sermons/v1/service-links";

// Exercise the real Supabase response handling without a database or credentials.
test("optional service links tolerate a missing migration without hiding other errors", async (t) => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  });

  let failure: string | null = "PGRST202";
  let featureEnabled = true;
  let visible = true;
  let linkCalls = 0;
  const presentation = { presentation_id: "slides", sermon_id: "sermon", title: "Sunday slides" };
  const live = {
    event_id: "event", state: "live", title: "Sunday service",
    starts_at: "2026-09-19T23:00:00Z", church_name: "Test Church", publication_version: 1,
  };
  const warnings = t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    let data: unknown;
    switch (url.pathname.split("/").pop()) {
      case "churches": data = { id: "church" }; break;
      case "church_features": data = { enabled: featureEnabled }; break;
      case "stream_recordings": data = null; break;
      case "mobile_media_live": data = visible ? [live] : []; break;
      case "mobile_media_version": data = 7; break;
      case "mobile_media_presentation":
      case "mobile_sermon_services":
        linkCalls++;
        if (failure) return Response.json({ code: failure, message: "RPC failed" }, { status: failure === "PGRST202" ? 404 : 403 });
        data = url.pathname.endsWith("mobile_media_presentation") ? [presentation] : [];
        break;
      default: throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return Response.json(data);
  });

  const result = await getLiveMedia({ userId: null, churchSlug: "test" });
  assert.equal(result.live?.mediaId, "event");
  assert.equal(result.live?.title, "Sunday service");
  assert.equal(result.live?.presentation, null);
  assert.equal(result.version, 7);
  assert.equal(await getLinkedPresentation("test", "joined", "recording", "recording"), null);
  assert.deepEqual(await getLinkedServices("test", null, { sermonId: "sermon" }), []);
  assert.equal(warnings.mock.callCount(), 3);

  failure = null;
  assert.deepEqual((await getLiveMedia({ userId: null, churchSlug: "test" })).live?.presentation,
    { presentationId: "slides", sermonId: "sermon", title: "Sunday slides" });

  failure = "42501";
  await assert.rejects(getLinkedPresentation("test", null, "live", "event"), { code: "unavailable" });
  await assert.rejects(getLinkedServices("test", null, { sermonId: "sermon" }), { code: "unavailable" });

  const previousCalls = linkCalls;
  featureEnabled = false;
  assert.equal(await getLinkedPresentation("test", null, "live", "event"), null);
  assert.deepEqual(await getLinkedServices("test", null, { sermonId: "sermon" }), []);
  visible = false;
  assert.deepEqual(await getLiveMedia({ userId: null, churchSlug: "test" }), { live: null, version: 7 });
  assert.equal(linkCalls, previousCalls, "disabled or invisible content must not request links");
});
