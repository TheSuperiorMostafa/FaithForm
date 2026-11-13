import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PageRenderer } from "@/components/sites/PageRenderer";
import { Media } from "@/components/sites/primitives";
import { ResilientImage } from "@/components/sites/resilient-image";
import { DEV_PREVIEW_PROFILE } from "@/lib/sites/dev-preview-profile";
import { buildSections } from "@/lib/sites/generate";
import { composeWebsiteSections, websitePageDefForType } from "@/lib/sites/layout-mode";
import { SECTION_REGISTRY } from "@/lib/sites/registry";
import { resolvePage } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";

Object.assign(globalThis, { React });

for (const theme of Object.values(CODE_SITE_THEMES)) {
  test(`${theme.name}: missing photos keep their layout without public editorial instructions`, () => {
    for (const mode of ["landing", "website"] as const) {
      const draft = buildSections(DEV_PREVIEW_PROFILE, null, mode);
      const rows = draft.sections.map((section, index) => ({ ...section, id: `section-${index}`, sortOrder: index * 10 }));
      for (const path of mode === "website" ? ["/", "/about", "/staff", "/sermons"] : ["/"]) {
        const page = resolvePage({
          page: { id: "page", path, title: draft.title, metaDescription: draft.metaDescription, status: "published" },
          theme, settings: null, profile: DEV_PREVIEW_PROFILE, overrides: [], registry: SECTION_REGISTRY,
          sections: mode === "landing" ? rows : composeWebsiteSections({
            path, homeSections: rows,
            pageSections: rows.filter(section => {
              const definition = websitePageDefForType(section.type);
              return definition ? definition.path === path : path === "/";
            }),
          }),
        });
        const html = renderToStaticMarkup(createElement(PageRenderer, {
          page, ...(mode === "website" ? { website: { path, churchName: DEV_PREVIEW_PROFILE.name, coverImageUrl: null } } : {}),
        }));
        assert.match(html, new RegExp(`data-theme="${theme.key}"`));
        if (path === "/staff") {
          assert.match(html, /class="site-staff-card site-staff-card--text-only"/, "staff without photos keep their identity instead of a large empty portrait");
          assert.match(html, /class="site-staff-initials" aria-hidden="true"/);
          assert.doesNotMatch(html, /class="site-ph site-staff-photo"/);
        } else {
          const frame = path === "/about" ? "site-figure" : path === "/sermons" ? "site-sermon-thumb" : "site-hero-media";
          assert.match(html, new RegExp(`<div class="site-ph ${frame}" aria-hidden="true"></div>`), `${mode}${path} keeps the designed decorative photo geometry`);
        }
        assert.doesNotMatch(html, /a photo of your|data-ph="(?:portrait|thumb|sermon still)"/, `${mode}${path} must not display instructions or prototype captions`);
        if (mode === "landing" || path === "/sermons") {
          assert.match(html, /<div class="site-sermon-stage site-ph"><span class="site-play" aria-hidden="true"><\/span><\/div>/, "a missing still keeps the stage and decorative play mark");
        }
      }
    }
  });
}

test("missing-photo instructions stay private while uploaded photos keep their accessible image and loading behavior", () => {
  const image = { src: null, alt: "Church building", placeholder: "Choose a photograph of your church" };
  assert.equal(renderToStaticMarkup(createElement(Media, { image, className: "site-figure", wrapperClassName: "custom-frame" })), '<div class="site-ph site-figure custom-frame" aria-hidden="true"></div>');
  assert.equal(image.placeholder, "Choose a photograph of your church", "rendering must preserve existing content and editor hints");
  assert.equal(renderToStaticMarkup(createElement(Media, { image: null })), "");
  const html = renderToStaticMarkup(createElement(Media, {
    image: { ...image, src: "https://example.test/church.jpg" }, className: "site-figure", priority: true,
  }));
  assert.match(html, /<img[^>]*src="https:\/\/example.test\/church.jpg"[^>]*alt="Church building"/);
  assert.match(html, /loading="eager"/);
  assert.match(html, /fetchPriority="high"/);
  assert.doesNotMatch(html, /Choose a photograph|data-ph=/);
});

test("an unavailable supplied photo still explains the failure accessibly", () => {
  const html = renderToStaticMarkup(createElement(ResilientImage, { src: "", alt: "Church building", className: "site-media" }));
  assert.match(html, /class="site-ph site-media"/);
  assert.match(html, /role="img"/);
  assert.match(html, /aria-label="Photo unavailable: Church building"/);
  assert.match(html, /data-ph="Photo unavailable"/);
  assert.equal(renderToStaticMarkup(createElement(ResilientImage, { src: "", alt: "Church building", fallback: "hide" })), "");
});
