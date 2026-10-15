import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WebsitePageExplore, WebsitePageIntro, type WebsitePageFrame } from "@/components/sites/website-page-frame";
import type { ResolvedPage, ResolvedSection } from "@/lib/sites/contract";

const row = (type: string, content: Record<string, unknown> = {}): ResolvedSection => ({ type, content, ctx: { id: type, anchor: type, index: 0 } });
const page: ResolvedPage = {
  slug: "grace", themeKey: "grace", title: "Grace", metaDescription: null,
  tokens: {}, customCss: null, sections: [row("give_cta")],
};
const website: WebsitePageFrame = { path: "/give", churchName: "Grace", coverImageUrl: "https://example.test/cover.jpg", basePath: "/sites/grace" };

function intro(frame: WebsitePageFrame, sections = page.sections) {
  return renderToStaticMarkup(createElement(WebsitePageIntro, { website: frame, page: { ...page, sections } }));
}

test("task pages have a clear heading without the repeated church photo or single-item contents menu", () => {
  for (const path of ["/give", "/sermons", "/programs", "/staff", "/vision"]) {
    const html = intro({ ...website, path });
    assert.match(html, /<h1/);
    assert.doesNotMatch(html, /<img|On this page/);
    assert.match(html, /href="\/sites\/grace"/);
  }
  assert.match(intro({ ...website, path: "/about" }), /<img/);
});

test("preview breadcrumbs stay in the draft and Visit links to the supplied location", () => {
  const html = intro({ ...website, path: "/visit", previewSlug: "grace", location: "123 Main St, Louisville", serviceTimes: ["Sunday 10 AM"] }, [row("visit_cta")]);
  assert.match(html, /href="\/sites\/grace\?preview=1"/);
  assert.match(html, /google\.com\/maps\/search\/\?api=1&amp;query=123%20Main%20St%2C%20Louisville/);
  assert.match(html, /Get directions/);
  assert.doesNotMatch(html, /Sunday 10 AM/); // Times render once in their dedicated block.
  assert.match(intro({ ...website, basePath: "", path: "/staff" }), /href="\/"/);
});

test("explore cards orient Home with three useful destinations and do not repeat on task pages", () => {
  const nav = row("site_nav", { links: ["give", "staff", "sermons", "programs", "about"].map((path) => ({ label: path, href: `/sites/grace/${path}` })), cta: { label: "Visit", href: "/sites/grace/visit" } });
  const home = renderToStaticMarkup(createElement(WebsitePageExplore, { website: { ...website, path: "/" }, page: { ...page, sections: [nav] } }));
  assert.equal((home.match(/class="site-page-card"/g) ?? []).length, 3);
  assert.match(home, /href="\/sites\/grace\/visit"/);
  assert.match(home, /href="\/sites\/grace\/sermons"/);
  assert.match(home, /href="\/sites\/grace\/programs"/);
  assert.doesNotMatch(home, /href="\/sites\/grace\/give"/);
  for (const path of ["/give", "/sermons", "/programs", "/staff", "/vision", "/visit"]) {
    assert.equal(renderToStaticMarkup(createElement(WebsitePageExplore, { website: { ...website, path }, page })), "");
  }
});
