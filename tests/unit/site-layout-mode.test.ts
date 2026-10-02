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
