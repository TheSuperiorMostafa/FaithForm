import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sites/contact/route";
import { buildSiteProfile, getSiteBundle, getSiteNavigationPages } from "@/lib/sites/queries";
import { availableWebsitePaths } from "@/lib/sites/public-navigation";
import ChurchSitePage, { generateMetadata } from "@/app/sites/[slug]/[[...path]]/page";

test("contact submissions use the hosting church's inbox and reject offline/unknown websites", async (t) => {
  const env = {
    NEXT_PUBLIC_SITE_URL: "https://app.faithform.test",
    NEXT_PUBLIC_SITE_ROOT_HOST: "faithform.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
    SUPABASE_SECRET_KEY: "test-secret",
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let published = true;
  let homePublished = true;
  let featureEnabled = true;
  let limiterAvailable = true;
  const delivered: Record<string, unknown>[] = [];
  const churchReads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").pop();
    switch (table) {
      case "site_domains": return Response.json(url.searchParams.get("hostname") === "eq.contact-church.example" ? [{ churches: { slug: "grace" } }] : []);
      case "consume_api_rate_limit": return limiterAvailable
        ? Response.json([{ allowed: true, retry_after_seconds: 0 }])
        : Response.json({ message: "limiter unavailable" }, { status: 500 });
      case "churches": churchReads.push(url.searchParams.get("slug")!); return Response.json({ id: "church-grace", name: "Grace Church", email: "office@example.test" });
      case "site_settings": return Response.json({ is_published: published, contact_email: "inbox@example.test" });
      case "site_pages": assert.equal(url.searchParams.get("path"), "eq./"); return Response.json({ status: homePublished ? "published" : "draft" });
      case "church_features": return Response.json({ enabled: featureEnabled, emails_enabled: false });
      case "site_contact_submissions":
        assert.equal(options?.method, "POST");
        delivered.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
        return Response.json({ id: `submission-${delivered.length}` });
      default: throw new Error(`Unexpected network request ${url}`);
    }
  });
  const send = (host: string, query = "other") => POST(new NextRequest(`https://${host}/api/sites/contact?site=${query}`, {
    method: "POST", headers: { host, "content-type": "application/json" },
    body: JSON.stringify({ name: "Safe test visitor", email: "visitor@example.test", message: "Local regression test" }),
  }));
  assert.equal((await send("contact-church.example")).status, 200);
  assert.deepEqual(churchReads, ["eq.grace"], "custom-domain ?site cannot redirect an enquiry");
  assert.equal(delivered[0].church_id, "church-grace");
  assert.equal(delivered[0].message, "Local regression test");
  assert.equal((await send("grace.faithform.test")).status, 200);
  assert.equal(churchReads.at(-1), "eq.grace", "FaithForm subdomain is authoritative too");
  const before = delivered.length;
  published = false;
  assert.equal((await send("app.faithform.test", "grace")).status, 404);
  published = true; homePublished = false;
  assert.equal((await send("app.faithform.test", "grace")).status, 404);
  homePublished = true; featureEnabled = false;
  assert.equal((await send("app.faithform.test", "grace")).status, 404);
  featureEnabled = true;
  assert.equal((await send("unknown-contact.example", "grace")).status, 400);
  assert.equal(delivered.length, before, "offline/unknown websites must not write submissions");
  limiterAvailable = false;
  t.mock.method(console, "error", () => {});
  assert.equal((await send("app.faithform.test", "grace")).status, 503, "an unavailable limiter must not pretend the visitor sent too many messages");
});

test("public profile queries exclude private announcements and scope sections to their church", async (t) => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://database.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  });
  let sectionReads = 0;
  let layoutMode = "landing";
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").pop();
    if (table === "churches") return Response.json({ id: "church-grace", name: "Grace", slug: "grace" });
    if (table === "site_settings") return Response.json({ theme_key: "grace", is_published: true, layout_mode: layoutMode });
    if (table === "site_pages") {
      if (url.searchParams.get("select")?.includes("site_sections")) {
        assert.equal(url.searchParams.get("church_id"), "eq.church-grace");
        return Response.json([
          { path: "/", status: "published", site_sections: [{ type: "hero", is_visible: true, church_id: "church-grace" }] },
          { path: "/staff", status: "published", site_sections: [{ type: "staff_grid", is_visible: false, church_id: "church-grace" }, { type: "staff_grid", is_visible: true, church_id: "other" }] },
          { path: "/visit", status: "published", site_sections: [{ type: "visit_cta", is_visible: true, church_id: "church-grace" }] },
        ]);
      }
      return Response.json({ id: "page-grace", path: url.searchParams.get("path")?.slice(3) || "/", status: "published" });
    }
    if (table === "site_themes") return Response.json({ key: "grace", name: "Grace", tokens: {}, section_defaults: {} });
    if (table === "site_sections") {
      sectionReads++;
      assert.equal(url.searchParams.get("church_id"), "eq.church-grace");
      assert.equal(url.searchParams.get("page_id"), "eq.page-grace");
      return Response.json([]);
    }
    if (table === "announcements") {
      assert.equal(url.searchParams.get("church_id"), "eq.church-grace");
      assert.equal(url.searchParams.get("status"), "eq.published");
      assert.equal(url.searchParams.get("mobile_visibility"), "eq.public");
      return Response.json([{ event_title: "Public picnic", event_date: "2030-06-01T12:00:00Z", notes: "Everyone welcome" }]);
    }
    if (table === "church_staff") assert.equal(url.searchParams.get("is_public"), "eq.true");
    if (table === "site_media") assert.equal(url.searchParams.get("is_published"), "eq.true");
    return Response.json([]);
  });
  assert.equal((await buildSiteProfile("church-grace"))?.events[0].title, "Public picnic");
  assert.equal((await getSiteBundle("grace"))?.profile.events[0].title, "Public picnic");
  assert.equal(sectionReads, 1);

  for (const preview of [undefined, "1"]) {
    const props = { params: Promise.resolve({ slug: "grace", path: ["about"] }), searchParams: Promise.resolve({ preview }) };
    await assert.rejects(ChurchSitePage(props), (error: unknown) =>
      error instanceof Error && "digest" in error && error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
    "landing layouts must reject leftover subpages, including authorized-preview URLs");
    assert.deepEqual(await generateMetadata(props), { title: "Not found" });
  }
  assert.deepEqual(availableWebsitePaths(await getSiteNavigationPages("church-grace"), false), ["/", "/visit"], "hidden and cross-church section rows cannot advertise a destination");
  layoutMode = "website";
  for (const preview of [undefined, "1"]) {
    const props = { params: Promise.resolve({ slug: "grace", path: ["staff"] }), searchParams: Promise.resolve({ preview }) };
    await assert.rejects(ChurchSitePage(props), (error: unknown) =>
      error instanceof Error && "digest" in error && error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
    "hidden primary sections must not leave an empty public or preview page");
    assert.deepEqual(await generateMetadata(props), { title: "Not found" });
  }
});
