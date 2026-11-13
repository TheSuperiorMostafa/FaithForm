import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { websiteSermonMedia } from "@/lib/sites/sermon-media";
import { getRecordingWatchUrl } from "@/lib/site-url";
import { getSiteBundle } from "@/lib/sites/queries";
import { getWebsiteSermonsUrl } from "@/lib/stream/recording-publication";

function configure(t: TestContext) {
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test", SUPABASE_SECRET_KEY: "test-secret", NEXT_PUBLIC_SITE_URL: "https://app.faithform.test" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

test("published website recordings join existing links without exposing unlisted/foreign rows or duplicating authored links", () => {
  const recordings = [
    { id: "recording-a", church_id: "church-a", listed: true, title: "Sunday service", recorded_at: "2026-11-01", poster_url: "https://images.example/cover.jpg", speakers: ["Pastor Ann"], series_name: "Hope" },
    { id: "private", church_id: "church-a", listed: false, title: "Unlisted", recorded_at: "2026-11-03" },
    { id: "foreign", church_id: "church-b", listed: true, title: "Other church", recorded_at: "2026-11-04" },
  ];
  const links = [{ id: "external", title: "Existing YouTube message", video_url: "https://youtube.example/watch?v=sermon", published_at: "2026-10-01" }];
  const media = websiteSermonMedia({ churchId: "church-a", slug: "grace", recordings, links });
  assert.deepEqual(media.map(item => item.title), ["Sunday service", "Existing YouTube message"]);
  assert.equal(media[0].videoUrl, getRecordingWatchUrl("grace", "recording-a"));
  assert.equal(media[0].speaker, "Pastor Ann");
  assert.equal(media[0].thumbnail?.src, "https://images.example/cover.jpg");
  const duplicate = websiteSermonMedia({ churchId: "church-a", slug: "grace", recordings, links: [...links, { id: "manual", title: "My existing title", video_url: getRecordingWatchUrl("grace", "recording-a"), published_at: "2026-11-01" }] });
  assert.equal(duplicate.length, 2);
  assert.ok(duplicate.some(item => item.title === "My existing title"));
});

test("the actual website query loads canonical listed recordings and removes them when unpublished", async t => {
  configure(t);
  let published = true, rpcCalls = 0;
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    switch (url.pathname.split("/").pop()) {
      case "churches": return Response.json({ id: "church-a", slug: "grace", name: "Grace Church" });
      case "site_settings": return Response.json({ theme_key: "grace", layout_mode: "landing", is_published: true });
      case "site_pages": return Response.json({ id: "home-a", path: "/", status: "published" });
      case "site_themes": return Response.json({ key: "grace", name: "Grace", tokens: {}, section_defaults: {} });
      case "site_media": return Response.json([{ id: "manual", title: "Existing link", video_url: "https://video.example/sermon", published_at: "2026-10-01" }]);
      case "web_recordings":
        rpcCalls++;
        assert.deepEqual(JSON.parse(String(options?.body)), { p_church_slug: "grace", p_recording_id: null, p_limit: 12 });
        return Response.json(published ? [{ id: "recording-a", church_id: "church-a", listed: true, title: "Uploaded sermon", recorded_at: "2026-11-01" }] : []);
      default: return Response.json([]);
    }
  });
  const before = await getSiteBundle("grace");
  assert.deepEqual(before?.profile.media.map(item => item.title), ["Uploaded sermon", "Existing link"]);
  assert.equal(before?.profile.media[0].videoUrl, "https://app.faithform.test/live/grace/watch/recording-a");
  published = false;
  assert.deepEqual((await getSiteBundle("grace"))?.profile.media.map(item => item.title), ["Existing link"]);
  assert.equal(rpcCalls, 2);
});

test("View Sermons requires published Home, an available destination and its own visible feed; failed reads recover", async t => {
  configure(t);
  let settings = { layout_mode: "website", is_published: true };
  let pages = [
    { id: "home-a", church_id: "church-a", path: "/", status: "published" },
    { id: "sermons-a", church_id: "church-a", path: "/sermons", status: "published" },
  ];
  let sections = [{ church_id: "church-a", page_id: "sermons-a", is_visible: true }];
  let failed = false;
  t.mock.method(globalThis, "fetch", async (resource: RequestInfo | URL) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    const table = url.pathname.split("/").pop();
    if (table === "churches") { assert.equal(url.searchParams.get("id"), "eq.church-a"); return Response.json({ slug: "grace" }); }
    assert.equal(url.searchParams.get("church_id"), "eq.church-a");
    if (failed) return Response.json({ message: "injected failure", code: "42501" }, { status: 403 });
    if (table === "site_settings") return Response.json(settings);
    if (table === "site_pages") return Response.json(pages);
    assert.equal(table, "site_sections");
    assert.equal(url.searchParams.get("type"), "eq.sermon_feed");
    assert.equal(url.searchParams.get("is_visible"), "eq.true");
    return Response.json(sections);
  });
  assert.equal(await getWebsiteSermonsUrl("church-a"), "https://app.faithform.test/sites/grace/sermons");
  settings.is_published = false; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  settings.is_published = true; pages[0].status = "draft"; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  pages[0].status = "published"; pages[1].status = "draft"; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  pages[1].status = "published"; sections[0].is_visible = false; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  sections[0].is_visible = true; sections[0].church_id = "church-b"; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  sections[0].church_id = "church-a"; pages[1].church_id = "church-b"; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  pages[1].church_id = "church-a"; failed = true; assert.equal(await getWebsiteSermonsUrl("church-a"), null);
  failed = false; assert.equal(await getWebsiteSermonsUrl("church-a"), "https://app.faithform.test/sites/grace/sermons");
  settings = { layout_mode: "landing", is_published: true }; sections = [{ church_id: "church-a", page_id: "home-a", is_visible: true }];
  assert.equal(await getWebsiteSermonsUrl("church-a"), "https://app.faithform.test/sites/grace#sermons");
  pages = pages.filter(page => page.path !== "/"); assert.equal(await getWebsiteSermonsUrl("church-a"), null);
});
