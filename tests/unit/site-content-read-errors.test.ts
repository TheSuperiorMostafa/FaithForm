import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteProfile, getSiteBundle } from "@/lib/sites/queries";

/** Exercise the real Supabase query pipeline with synthetic transport responses. */
async function withDatabase(failedTable: string | null, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_SECRET_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sites-database.invalid";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_synthetic";
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(url.hostname, "sites-database.invalid", "tests must never reach a real provider");
    const table = url.pathname.split("/").at(-1);
    if (table === failedTable) return Response.json({ code: "42501", message: "private database detail" }, { status: 403 });
    const rows: Record<string, unknown> = {
      churches: { id: "church", slug: "synthetic", name: "Synthetic church" },
      site_settings: { theme_key: "grace", brand_tokens: {}, custom_css: null, is_published: false,
        site_themes: { key: "grace", name: "Grace", tokens: {}, section_defaults: {} } },
      site_pages: { id: "home", path: "/", status: "draft", site_sections: [] },
      site_overrides: [], church_service_times: [], church_staff: [], announcements: [], site_media: [],
    };
    assert.ok(table && table in rows, `unexpected table ${table}`);
    return Response.json(rows[table!]);
  };
  try { await run(); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = originalSecret;
  }
}

test("failed hand-edit or profile reads cannot appear as a valid empty website", async () => {
  for (const table of ["site_overrides", "church_service_times", "church_staff", "announcements", "site_media"]) {
    await withDatabase(table, async () => {
      await assert.rejects(getSiteBundle("synthetic"), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Website content could not be loaded/);
        assert.doesNotMatch(error.message, /private database detail/);
        return true;
      }, table);
    });
  }
});

test("first-draft generation refuses incomplete church details", async () => {
  await withDatabase("church_staff", async () => {
    await assert.rejects(buildSiteProfile("church"), /website details could not be loaded/);
  });
});

test("successful empty reads remain valid for a new website without staff or media", async () => {
  await withDatabase(null, async () => {
    const bundle = await getSiteBundle("synthetic");
    assert.ok(bundle);
    assert.deepEqual(bundle.overrides, []);
    assert.deepEqual(bundle.profile.staff, []);
    assert.deepEqual(bundle.profile.media, []);
    assert.deepEqual(bundle.profile.serviceTimes, []);
  });
});
