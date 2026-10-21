import assert from "node:assert/strict";
import test from "node:test";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { normalizeLandingHrefs } from "@/lib/sites/layout-mode";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { diffPatch, resolvePage, resolveSectionBaseline } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";

const theme = CODE_SITE_THEMES.grace;
const profile = { ...DEV_PREVIEW_PROFILE, slug: "grace" };
const page = { id: "home", path: "/", title: "Home", metaDescription: null, status: "draft" as const };
const nav = { id: "nav", type: "site_nav", sortOrder: 0, isVisible: true, props: { links: [{ label: "About", href: "/about" }] } };

test("edited menu labels survive Website to Landing and back with working destinations", () => {
  const baseline = resolveSectionBaseline({ row: nav, master: SECTION_REGISTRY.site_nav, theme, profile, overrides: [], pageId: page.id });
  const patch = diffPatch(baseline, { ...baseline, links: [{ label: "Our story", href: "/about" }] });
  const overrides = [{ scope: "section" as const, sectionId: nav.id, pageId: null, patch }];
  for (const [layoutMode, href] of [["landing", "#about"], ["website", "/about"]] as const) {
    const resolved = resolvePage({ page, theme, profile, sections: [nav], registry: SECTION_REGISTRY, overrides,
      settings: { themeKey: theme.key, brandTokens: {}, customCss: null, contactEmail: null, isPublished: false, layoutMode } });
    assert.deepEqual(resolved.sections[0].content.links, [{ label: "Our story", href }]);
  }
  assert.deepEqual(patch.links, [{ label: "Our story", href: "/about" }], "render normalization never mutates saved hand edits");
});

test("landing normalization preserves queries, explicit fragments and own church page prefixes", () => {
  assert.deepEqual(normalizeLandingHrefs({ links: [
    { href: "/about?from=nav" }, { href: "/about?from=nav#story" },
    { href: "/sites/grace/visit?preview=1#visit-form" }, { href: "/sites/grace/staff/" },
  ] }, "grace"), { links: [
    { href: "?from=nav#about" }, { href: "?from=nav#story" },
    { href: "?preview=1#visit-form" }, { href: "#staff" },
  ] });
});

test("custom paths, downloads, external links and text values are not rewritten", () => {
  const input = { title: "/about", body: "#visit", links: [
    "/our-history?from=nav#story", "/downloads/about.pdf", "/api/download?path=/about",
    "https://example.test/about", "//example.test/visit", "/\\example.test/about", "/sites/other/about",
    "mailto:hello@example.test", "tel:+15025550123", "#custom-anchor", "/give/grace?amount=20",
  ].map(href => ({ href })) };
  assert.deepEqual(normalizeLandingHrefs(input, "grace"), input);
});
