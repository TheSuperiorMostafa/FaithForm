import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageRenderer } from "@/components/sites/PageRenderer";
import { visitCtaSection } from "@/components/sites/sections/visit-cta";
import { ContactForm } from "@/components/sites/sections/contact-form";
import { GiveCtaView } from "@/components/sites/sections/give-cta-view";
import { giveCtaSection } from "@/components/sites/sections/give-cta";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { buildSections } from "@/lib/sites/generate";
import { availableWebsitePaths, filterUnavailableSiteLinks } from "@/lib/sites/public-navigation";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";
import type { GiveCtaContent, VisitCtaContent } from "@/types/site";

Object.assign(globalThis, { React });
const visitDefaults = visitCtaSection.defaults as VisitCtaContent;

test("hiding landing sections removes their generated menu/footer/buttons in every theme without changing stored content", () => {
  const profile = { ...DEV_PREVIEW_PROFILE, givingEnabled: true };
  const generated = buildSections(profile, null, "landing");
  const hidden = new Set(["vision_mission", "staff_grid", "visit_cta", "give_cta", "sermon_feed"]);
  for (const theme of Object.values(CODE_SITE_THEMES)) {
    const page = resolvePage({
      page: { id: "home", path: "/", title: "Home", status: "published", metaDescription: null },
      theme, settings: { themeKey: theme.key, brandTokens: {}, customCss: null, contactEmail: null, isPublished: true, layoutMode: "landing" },
      sections: generated.sections.map((section, index) => ({ ...section, id: `section-${index}`, sortOrder: index, isVisible: !hidden.has(section.type) && section.isVisible })),
      overrides: [], profile, registry: SECTION_REGISTRY,
    });
    const before = JSON.stringify(page.sections);
    const anchors = page.sections.map(section => section.ctx.anchor);
    const visible = { ...page, sections: page.sections.map(section => ({ ...section, content: filterUnavailableSiteLinks(section.content, { slug: profile.slug, availableAnchors: anchors }) as Record<string, unknown> })) };
    const html = renderToStaticMarkup(createElement(PageRenderer, { page: visible }));
    assert.doesNotMatch(html, /href="#(?:vision|staff|visit|give|sermons)"/, theme.key);
    assert.match(html, /href="#about"/, theme.key);
    assert.equal(JSON.stringify(page.sections), before, "visibility must not rewrite saved or resolved source content");
  }
});

test("website visibility excludes hidden/missing/draft pages while previews include visible drafts", () => {
  const pages = [
    { path: "/", status: "published", visibleTypes: ["hero"] },
    { path: "/about", status: "draft", visibleTypes: ["about_text"] },
    { path: "/staff", status: "published", visibleTypes: [] },
    { path: "/visit", status: "published", visibleTypes: ["visit_cta", "service_times"] },
  ];
  assert.deepEqual(availableWebsitePaths(pages, false), ["/", "/visit"]);
  assert.deepEqual(availableWebsitePaths(pages, true), ["/", "/about", "/visit"]);
  const source = {
    body: "/staff is mentioned in our story",
    links: ["/staff", "/sites/grace/sermons?from=footer", "/visit", "/about", "/staffing", "/sites/other/staff", "https://outside.example/staff", "/give/grace?fund=missions"].map(href => ({ label: "Original label", href })),
    cta: { label: "Meet our staff", href: "/staff" },
  };
  assert.deepEqual(filterUnavailableSiteLinks(source, { slug: "grace", availablePaths: availableWebsitePaths(pages, false) }), {
    ...source, links: source.links.slice(2).filter(link => link.href !== "/about"), cta: null,
  });
});

test("a Visit section with no facts or form removes its empty panel and default dead button", () => {
  const content = { ...visitDefaults, form: { ...visitDefaults.form, enabled: false }, facts: [] };
  const ctx = { id: "visit", anchor: "visit", index: 0 };
  const html = renderToStaticMarkup(createElement(visitCtaSection.Component, { content, ctx }));
  assert.doesNotMatch(html, /href="#visit-form"|id="visit-form"|<form/);
  assert.match(html, /--site-split:1fr/);
  const external = renderToStaticMarkup(createElement(visitCtaSection.Component, { content: { ...content, action: { label: "Call our church", href: "tel:+15025550123", variant: "solid" } }, ctx }));
  assert.match(external, /href="tel:\+15025550123"/);
});

test("cleared contact/giving labels retain usable and accessible action names", () => {
  const form = renderToStaticMarkup(createElement(ContactForm, {
    config: { ...visitDefaults.form, submitLabel: " " },
  }));
  assert.match(form, />Send message<\/button>/);
  const giving = renderToStaticMarkup(createElement(GiveCtaView, {
    content: { ...giveCtaSection.defaults, submitLabel: "", otherLabel: " " } as GiveCtaContent,
    ctx: { id: "give", anchor: "give", index: 0 },
  }));
  assert.match(giving, />Give \$10<\/a>/);
  assert.match(giving, />Other amount<\/button>/);
});
