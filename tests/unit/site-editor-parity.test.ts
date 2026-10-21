import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebsitePageIntro } from "@/components/sites/website-page-frame";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { diffPatch, resolvePage, resolveSectionBaseline } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";
import type { SiteOverrideRow, SiteSectionRow } from "@/types/site";

Object.assign(globalThis, { React });
const theme = CODE_SITE_THEMES.grace;
const profile = { ...DEV_PREVIEW_PROFILE, coverImageUrl: "https://example.test/original.jpg" };
const settings = { themeKey: theme.key, brandTokens: {}, customCss: null, contactEmail: null, isPublished: true, layoutMode: "website" as const };
const page = { id: "about-page", path: "/about", title: "About", metaDescription: null, status: "published" as const };
const row: SiteSectionRow = { id: "about", type: "about_text", sortOrder: 10, isVisible: true, props: {} };

test("page intro edits resolve identically to section fields and survive public rendering", () => {
  const baseline = resolveSectionBaseline({ row, master: SECTION_REGISTRY.about_text, theme, profile, overrides: [], pageId: page.id });
  assert.deepEqual(baseline.pageIntro, { title: "Get to know us", description: "Discover our story and the community you'll find here.", image: { src: profile.coverImageUrl, alt: "" } });
  const patch = diffPatch(baseline, { ...baseline, pageIntro: { title: "Our local church", description: "", image: { src: "https://example.test/new.jpg", alt: "Our church family" } } });
  assert.deepEqual(Object.keys(patch), ["pageIntro"]);
  const overrides: SiteOverrideRow[] = [{ scope: "section", sectionId: row.id, pageId: null, patch }];
  const resolved = resolvePage({ page, theme, profile, settings, sections: [row], overrides, registry: SECTION_REGISTRY });
  const html = renderToStaticMarkup(createElement(WebsitePageIntro, { page: resolved, website: { path: "/about", churchName: profile.name, coverImageUrl: profile.coverImageUrl } }));
  assert.match(html, /Our local church/);
  assert.match(html, /new\.jpg/);
  assert.match(html, /alt="Our church family"/);
  assert.doesNotMatch(html, /Get to know us|Discover our story|original\.jpg/);
});

test("clearing an intro photo stays cleared instead of restoring the church cover", () => {
  const resolved = resolvePage({ page, theme, profile, settings, sections: [row], overrides: [{ scope: "section", sectionId: row.id, pageId: null, patch: { pageIntro: { image: { src: null } } } }], registry: SECTION_REGISTRY });
  const html = renderToStaticMarkup(createElement(WebsitePageIntro, { page: resolved, website: { path: "/about", churchName: profile.name, coverImageUrl: profile.coverImageUrl } }));
  assert.doesNotMatch(html, /<img/);
});

test("shared rows keep Home page overrides while the page body keeps its own", () => {
  const nav = { ...row, id: "nav", type: "site_nav", sortOrder: 0 };
  const overrides: SiteOverrideRow[] = [
    { scope: "page", pageId: "home-page", sectionId: null, patch: { sections: { site_nav: { title: "Our shared menu" }, about_text: { eyebrow: "Wrong source" } } } },
    { scope: "page", pageId: page.id, sectionId: null, patch: { sections: { site_nav: { title: "Wrong page menu" }, about_text: { eyebrow: "About this church" } } } },
  ];
  const resolved = resolvePage({ page, theme, profile, settings, sections: [nav, row], overrides, registry: SECTION_REGISTRY, sectionPageIds: { nav: "home-page" } });
  assert.equal(resolved.sections[0].content.title, "Our shared menu");
  assert.equal(resolved.sections[1].content.eyebrow, "About this church");
});

test("the Visit button can be renamed, linked, and hidden independently of its form in every style", () => {
  const master = SECTION_REGISTRY.visit_cta;
  const visitRow = { ...row, id: "visit", type: "visit_cta" };
  const visitPage = { ...page, id: "visit-page", path: "/visit" };
  for (const theme of Object.values(CODE_SITE_THEMES)) {
    const baseline = resolveSectionBaseline({ row: visitRow, master, theme, profile, overrides: [], pageId: visitPage.id });
    const edited = { ...baseline, action: { label: "Meet our team", href: "/staff", variant: "solid" } };
    const patch = diffPatch(baseline, edited);
    const render = (patch: Record<string, unknown>) => {
      const resolved = resolvePage({ page: visitPage, theme, profile, settings: { ...settings, themeKey: theme.key }, sections: [visitRow], overrides: [{ scope: "section", sectionId: visitRow.id, pageId: null, patch }], registry: SECTION_REGISTRY });
      return renderToStaticMarkup(createElement(master.Component, { content: resolved.sections[0].content, ctx: resolved.sections[0].ctx }));
    };
    assert.match(render(patch), /href="\/staff"[^>]*>Meet our team/);
    const hidden = render(diffPatch(baseline, { ...edited, action: { ...edited.action, label: "" } }));
    assert.doesNotMatch(hidden, /Meet our team|Plan your visit/);
    assert.match(hidden, /<form/);
  }
});
