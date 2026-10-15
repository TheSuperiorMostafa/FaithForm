import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WebsitePageExplore } from "@/components/sites/website-page-frame";
import { isCurrentSiteLink } from "@/lib/sites/active-link";
import { PageRenderer } from "@/components/sites/PageRenderer";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { buildSections } from "@/lib/sites/generate";
import { composeWebsiteSections, isWebsiteHomeSectionType, WEBSITE_PAGE_DEFS, websitePageDefForType, websiteSupportingPaths } from "@/lib/sites/layout-mode";
import { rewriteSiteNavigation } from "@/lib/sites/public-navigation";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";
import type { SiteThemeDefinition } from "@/lib/sites/themes/types";

// tsx uses classic JSX outside Next.js, as in the other SSR tests.
Object.assign(globalThis, { React });

const profile = { ...DEV_PREVIEW_PROFILE, coverImageUrl: "https://example.test/church.jpg" };

function resolve(theme: SiteThemeDefinition, path: string, mode: "website" | "landing" = "website") {
  const draft = buildSections(profile, null, mode);
  const rows = draft.sections.map((section, index) => ({
    ...section, id: `section-${index}`, sortOrder: index * 10,
  }));
  const includedPaths = new Set([path, ...websiteSupportingPaths(path)]);
  const pageRows = rows.filter((section) => {
    const def = websitePageDefForType(section.type);
    return def ? includedPaths.has(def.path) : path === "/";
  });
  return resolvePage({
    page: { id: "page", path, title: draft.title, metaDescription: draft.metaDescription, status: "published" },
    theme,
    settings: { themeKey: theme.key, brandTokens: {}, customCss: null, contactEmail: null, isPublished: true, layoutMode: mode },
    sections: mode === "website" ? composeWebsiteSections({ path, homeSections: rows, pageSections: pageRows }) : rows,
    overrides: [], profile, registry: SECTION_REGISTRY,
  });
}

for (const theme of Object.values(CODE_SITE_THEMES)) {
  test(`${theme.name}: every website page renders its content and shared navigation in the selected theme`, () => {
    for (const path of ["/", ...WEBSITE_PAGE_DEFS.map((def) => def.path)]) {
      const page = resolve(theme, path);
      const primaryType = WEBSITE_PAGE_DEFS.find((def) => def.path === path)?.type;
      assert.equal(page.themeKey, theme.key);
      assert.equal(page.tokens["--site-ink"], theme.tokens["--site-ink"]);
      assert.equal(page.sections[0].type, "site_nav");
      assert.equal(page.sections.at(-1)?.type, "footer_map");
      if (primaryType) {
        assert.equal(page.sections.filter((section) => section.type === primaryType).length, 1, path);
        assert.ok(!page.sections.some((section) => section.type === "hero"), path);
        const expectedContent = new Set([path, ...websiteSupportingPaths(path)]);
        assert.deepEqual(new Set(page.sections.filter((section) => !isWebsiteHomeSectionType(section.type)).map((section) => websitePageDefForType(section.type)?.path)), expectedContent);
      }
      const html = renderToStaticMarkup(createElement(PageRenderer, {
        page,
        website: { path, churchName: profile.name, coverImageUrl: profile.coverImageUrl, location: "120 Main Street, Springfield, KY" },
      }));
      assert.match(html, new RegExp(`data-theme="${theme.key}"`));
      assert.match(html, /data-layout="website"/);
      assert.equal((html.match(/<h1(?:\s|>)/g) ?? []).length, 1, `${theme.key}${path} needs one page heading`);
      assert.match(html, /aria-current="page"/, `${theme.key}${path} needs a current navigation item`);
      for (const def of WEBSITE_PAGE_DEFS) assert.ok(html.includes(`href="${def.path}"`), `${theme.key}${path} cannot reach ${def.path}`);
    }
  });

  test(`${theme.name}: every page keeps app-host, custom-domain and draft navigation consistent`, () => {
    for (const path of ["/", ...WEBSITE_PAGE_DEFS.map((def) => def.path)]) {
      const page = resolve(theme, path);
      for (const preview of [false, true]) {
        const scoped = page.sections.map((section) => ({ ...section, content: rewriteSiteNavigation(section.content, {
          slug: profile.slug, basePath: `/sites/${profile.slug}`, preview,
        }) as Record<string, unknown> }));
        const nav = scoped[0].content;
        const links = [...nav.links as { href: string }[], nav.cta as { href: string }];
        assert.equal(links.length, WEBSITE_PAGE_DEFS.length);
        for (const def of WEBSITE_PAGE_DEFS) assert.ok(links.some((link) => link.href === `/sites/${profile.slug}${def.path}${preview ? "?preview=1" : ""}`));
        const customDomainNav = rewriteSiteNavigation(nav, { slug: profile.slug, basePath: "", preview: false }) as typeof nav;
        const customLinks = [...customDomainNav.links as { href: string }[], customDomainNav.cta as { href: string }];
        assert.deepEqual(customLinks.map((link) => link.href), links.map((link) => new URL(link.href, "https://example.test").pathname.replace(`/sites/${profile.slug}`, "")));
      }
    }
  });

  test(`${theme.name}: the clickable theme preview retains Home explore cards and active pages`, () => {
    const page = resolve(theme, "/");
    const basePath = `/dev-site-preview/${theme.key}?mode=website`;
    const nav = page.sections[0].content;
    const fixtureLink = (link: { href: string }) => ({ ...link, href: `${basePath}&path=${encodeURIComponent(link.href)}` });
    const links = (nav.links as { href: string }[]).map(fixtureLink);
    const cta = fixtureLink(nav.cta as { href: string });
    page.sections[0] = { ...page.sections[0], content: { ...nav, links, cta } };
    const html = renderToStaticMarkup(createElement(WebsitePageExplore, {
      page, website: { path: "/", basePath, churchName: profile.name, coverImageUrl: profile.coverImageUrl },
    }));
    assert.equal((html.match(/class="site-page-card"/g) ?? []).length, 3);
    for (const path of ["/visit", "/programs", "/sermons"]) {
      const href = `${basePath}&path=${encodeURIComponent(path)}`;
      assert.ok(html.includes(href.replaceAll("&", "&amp;")), path);
      assert.equal(isCurrentSiteLink(href, path, basePath), true);
      assert.equal(isCurrentSiteLink(href, "/", basePath), false);
    }
    assert.equal(isCurrentSiteLink(basePath, "/", basePath), true);
  });

  test(`${theme.name}: landing mode still renders all sections and uses scroll navigation`, () => {
    const page = resolve(theme, "/", "landing");
    const links = page.sections[0].content.links as { href: string }[];
    assert.ok(links.every((link) => link.href.startsWith("#")));
    const html = renderToStaticMarkup(createElement(PageRenderer, { page }));
    assert.match(html, /data-layout="landing"/);
    assert.doesNotMatch(html, /site-page-intro/);
    for (const def of WEBSITE_PAGE_DEFS) assert.ok(page.sections.some((section) => section.type === def.type));
  });
}
