import assert from "node:assert/strict";
import test from "node:test";

import { buildSections } from "@/lib/sites/generate";
import {
  buildFooterExploreLinks,
  buildHeroActions,
  buildSiteNavLinks,
  buildVisitCta,
  composeWebsiteSections,
  normalizeSitePath,
  parseSiteLayoutMode,
  rewriteKnownHrefs,
  rewritePreviewLinks,
  sortSectionsForLanding,
  websitePageDefForPath,
  websitePageDefForType,
  WEBSITE_HOME_SECTION_TYPES,
  WEBSITE_PAGE_DEFS,
} from "@/lib/sites/layout-mode";
import type { SiteProfile, SiteSectionRow } from "@/types/site";

const profile: SiteProfile = {
  slug: "grace",
  name: "Grace Church",
  tagline: null,
  description: null,
  missionStatement: "Love God.",
  visionStatement: "Love people.",
  denomination: null,
  logoUrl: null,
  coverImageUrl: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  phone: null,
  email: "hello@grace.test",
  googleMapsUrl: null,
  facebookUrl: null,
  instagramUrl: null,
  youtubeUrl: null,
  tiktokUrl: null,
  xUrl: null,
  livestreamUrl: null,
  serviceTimes: [
    {
      label: "Sunday Worship",
      dayOfWeek: 0,
      startTime: "10:30",
      endTime: null,
      kind: "regular",
      notes: null,
    },
  ],
  staff: [{ name: "Pastor Ann", title: "Pastor", bio: null, photoUrl: null }],
  events: [],
  media: [
    {
      id: "1",
      title: "Welcome",
      series: null,
      speaker: null,
      date: null,
      videoUrl: null,
      thumbnail: null,
    },
  ],
  givingEnabled: true,
};

test("layout mode defaults to landing", () => {
  assert.equal(parseSiteLayoutMode(undefined), "landing");
  assert.equal(parseSiteLayoutMode("website"), "website");
  assert.equal(parseSiteLayoutMode("nope"), "landing");
});

test("normalizeSitePath turns catch-all segments into site_pages paths", () => {
  assert.equal(normalizeSitePath(undefined), "/");
  assert.equal(normalizeSitePath([]), "/");
  assert.equal(normalizeSitePath(["about"]), "/about");
  assert.equal(normalizeSitePath(["give", "thanks"]), "/give/thanks");
  assert.equal(normalizeSitePath("/about/"), "/about");
});

test("landing generation still uses hash menu links", () => {
  const draft = buildSections(profile, null, "landing");
  const nav = draft.sections.find((s) => s.type === "site_nav");
  const links = (nav?.props.links as { href: string }[]) ?? [];
  assert.ok(links.some((l) => l.href === "#about"));
  assert.ok(links.every((l) => l.href.startsWith("#")));
  assert.equal(
    (nav?.props.cta as { href: string } | undefined)?.href,
    "#visit",
  );

  const hero = draft.sections.find((s) => s.type === "hero");
  const actions = (hero?.props.actions as { href: string }[]) ?? [];
  assert.ok(actions.some((a) => a.href === "#visit"));
  assert.ok(actions.some((a) => a.href === "#sermons"));
});

test("website generation uses path menu links", () => {
  const draft = buildSections(profile, null, "website");
  const nav = draft.sections.find((s) => s.type === "site_nav");
  const links = (nav?.props.links as { href: string }[]) ?? [];
  assert.ok(links.some((l) => l.href === "/about"));
  assert.ok(links.every((l) => l.href.startsWith("/")));
  assert.equal(
    (nav?.props.cta as { href: string } | undefined)?.href,
    "/visit",
  );

  const hero = draft.sections.find((s) => s.type === "hero");
  const actions = (hero?.props.actions as { href: string }[]) ?? [];
  assert.ok(actions.some((a) => a.href === "/visit"));
  assert.ok(actions.some((a) => a.href === "/sermons"));

  // Structure is still the full landing list; apply-layout-mode partitions later.
  assert.ok(draft.sections.some((s) => s.type === "about_text"));
  assert.ok(draft.sections.some((s) => s.type === "give_cta"));
});

test("nav helpers skip Visit in the mid-menu and hide Give without Stripe", () => {
  const sections = [
    { type: "about_text", isVisible: true },
    { type: "visit_cta", isVisible: true },
    { type: "give_cta", isVisible: true },
  ];
  const landing = buildSiteNavLinks("landing", sections, {
    ...profile,
    givingEnabled: false,
  });
  assert.deepEqual(
    landing.map((l) => l.href),
    ["#about"],
  );
  assert.equal(buildVisitCta("website").href, "/visit");
  assert.equal(buildHeroActions("landing", false).length, 1);
});

test("rewriteKnownHrefs flips hashes and paths both ways", () => {
  assert.equal(rewriteKnownHrefs("#about", "website"), "/about");
  assert.equal(rewriteKnownHrefs("/visit", "landing"), "#visit");
  assert.deepEqual(
    rewriteKnownHrefs(
      { links: [{ label: "About", href: "#about" }], other: "#top" },
      "website",
    ),
    { links: [{ label: "About", href: "/about" }], other: "/" },
  );
});

test("composeWebsiteSections wraps subpage content with home chrome", () => {
  const home: SiteSectionRow[] = [
    { id: "n", type: "site_nav", sortOrder: 0, isVisible: true, props: {} },
    { id: "h", type: "hero", sortOrder: 10, isVisible: true, props: {} },
    { id: "c", type: "contact_band", sortOrder: 20, isVisible: true, props: {} },
    { id: "f", type: "footer_map", sortOrder: 30, isVisible: true, props: {} },
  ];
  const about: SiteSectionRow[] = [
    { id: "a", type: "about_text", sortOrder: 0, isVisible: true, props: {} },
  ];

  assert.deepEqual(
    composeWebsiteSections({
      path: "/",
      homeSections: home,
      pageSections: home,
    }).map((s) => s.id),
    ["n", "h", "c", "f"],
  );

  assert.deepEqual(
    composeWebsiteSections({
      path: "/about",
      homeSections: home,
      pageSections: about,
    }).map((s) => s.type),
    ["site_nav", "about_text", "contact_band", "footer_map"],
  );
});

test("website page defs cover the content sections moved off home", () => {
  for (const def of WEBSITE_PAGE_DEFS) {
    assert.equal(websitePageDefForType(def.type)?.path, def.path);
    assert.equal(websitePageDefForPath(def.path)?.type, def.type);
    assert.equal(WEBSITE_HOME_SECTION_TYPES.has(def.type), false);
  }
  assert.ok(WEBSITE_HOME_SECTION_TYPES.has("hero"));
  assert.ok(WEBSITE_HOME_SECTION_TYPES.has("site_nav"));
});

test("sortSectionsForLanding restores the usual scroll order", () => {
  const ordered = sortSectionsForLanding([
    { type: "footer_map", sortOrder: 0 },
    { type: "about_text", sortOrder: 0 },
    { type: "hero", sortOrder: 0 },
    { type: "site_nav", sortOrder: 0 },
  ]);
  assert.deepEqual(
    ordered.map((s) => s.type),
    ["site_nav", "hero", "about_text", "footer_map"],
  );
});

test("footer explore links follow the layout mode", () => {
  const sections = [
    { type: "about_text", isVisible: true },
    { type: "sermon_feed", isVisible: true },
    { type: "give_cta", isVisible: true },
    { type: "visit_cta", isVisible: true },
  ];
  const website = buildFooterExploreLinks("website", sections, profile);
  assert.ok(website.some((l) => l.href === "/about"));
  assert.ok(website.some((l) => l.href === "/sermons"));
  assert.ok(website.some((l) => l.href === "/give"));
  assert.ok(website.some((l) => l.href === "/visit"));
});


test("preview page links preserve the church, draft mode, query and fragment", () => {
  assert.deepEqual(rewritePreviewLinks({
    links: [
      { href: "/about#story" },
      { href: "/visit?from=home" },
      { href: "/" },
      { href: "/give/grace" },
      { href: "https://example.org/about" },
      { href: "#times" },
    ],
    body: "/about",
  }, "grace"), {
    links: [
      { href: "/sites/grace/about?preview=1#story" },
      { href: "/sites/grace/visit?from=home&preview=1" },
      { href: "/sites/grace?preview=1" },
      { href: "/give/grace" },
      { href: "https://example.org/about" },
      { href: "#times" },
    ],
    body: "/about",
  });
});

test("Visit includes service times and composed order survives resolution sorting", () => {
  const row = (type: string, sortOrder: number): SiteSectionRow => ({ id: type, type, sortOrder, isVisible: true, props: {} });
  const composed = composeWebsiteSections({
    path: "/visit",
    homeSections: [row("site_nav", 0), row("service_times", 20), row("footer_map", 5)],
    pageSections: [row("visit_cta", 80)],
  });
  assert.deepEqual(composed.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((s) => s.type), ["site_nav", "visit_cta", "service_times", "footer_map"]);
});

// A manually edited menu is merged after generated page props; normalize the
// final content so an old landing anchor cannot undo separate-page navigation.
test("resolved website links convert old manual and theme anchors without changing copy", async () => {
  const { normalizeWebsiteHrefs } = await import("@/lib/sites/layout-mode");
  const input = {
    title: "#about",
    links: [
      { label: "About", href: "#about" },
      { label: "Programs", href: "#programs-grid" },
      { label: "Custom section", href: "#our-story" },
      { label: "External", href: "https://example.com/#about" },
    ],
    cta: { label: "Visit", href: "#visit" },
  };
  const normalized = normalizeWebsiteHrefs(input);
  assert.deepEqual(normalized, {
    ...input,
    links: [
      { label: "About", href: "/about" },
      { label: "Programs", href: "/programs" },
      { label: "Custom section", href: "#our-story" },
      { label: "External", href: "https://example.com/#about" },
    ],
    cta: { label: "Visit", href: "/visit" },
  });
  assert.equal(input.links[0].href, "#about");
  assert.deepEqual(rewritePreviewLinks(normalized, "grace"), {
    ...normalized as Record<string, unknown>,
    links: [
      { label: "About", href: "/sites/grace/about?preview=1" },
      { label: "Programs", href: "/sites/grace/programs?preview=1" },
      { label: "Custom section", href: "#our-story" },
      { label: "External", href: "https://example.com/#about" },
    ],
    cta: { label: "Visit", href: "/sites/grace/visit?preview=1" },
  });
});

test("separate-page navigation wins after the final override cascade, while landing still scrolls", async () => {
  const { resolvePage } = await import("@/lib/sites/resolve");
  const { defineSection } = await import("@/lib/sites/contract");
  const nav = defineSection({
    type: "site_nav", defaults: { links: [] }, Component: () => null,
  });
  const input = {
    page: { id: "home", path: "/", title: null, metaDescription: null, status: "published" as const },
    theme: { key: "test", name: "Test", tokens: {}, sectionDefaults: {
      site_nav: { links: [{ label: "About", href: "#about" }] },
    } },
    profile,
    sections: [{ id: "nav", type: "site_nav", sortOrder: 0, isVisible: true,
      props: { links: [{ label: "About", href: "/about" }] } }],
    overrides: [{ scope: "section" as const, pageId: null, sectionId: "nav",
      patch: { links: [{ label: "About", href: "#about" }, { label: "Programs", href: "#programs" }] } }],
    registry: { site_nav: nav },
  };
  const settings = { themeKey: "test", brandTokens: {}, customCss: null, contactEmail: null, isPublished: true };
  const website = resolvePage({ ...input, settings: { ...settings, layoutMode: "website" } });
  assert.deepEqual(website.sections[0].content.links, [
    { label: "About", href: "/about" }, { label: "Programs", href: "/programs" },
  ]);
  const landing = resolvePage({ ...input, settings: { ...settings, layoutMode: "landing" } });
  assert.deepEqual(landing.sections[0].content.links, input.overrides[0].patch.links);
  const themed = resolvePage({ ...input, overrides: [], sections: [{ ...input.sections[0], props: {} }], settings: { ...settings, layoutMode: "website" } });
  assert.deepEqual(themed.sections[0].content.links, [{ label: "About", href: "/about" }]);
});
