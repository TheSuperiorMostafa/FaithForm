import assert from "node:assert/strict";
import test from "node:test";
import { canonicalWebsiteNavigationPath, normalizeLandingHrefs, normalizeWebsiteHrefs, websitePageDefForPath } from "@/lib/sites/layout-mode";
import { availableWebsitePaths, filterUnavailableSiteLinks, rewriteSiteNavigation } from "@/lib/sites/public-navigation";

const slug = "somerset-first-church-of-the-nazarene-dde3b23e";
const basePath = `/sites/${slug}`;
const source = {
  headline: "Services",
  body: "/services is the saved address; keep this church's copy intact.",
  links: [
    { label: "Services", href: "/services?from=menu#weekly-gatherings" },
    { label: "Existing Services", href: `${basePath}/services/?from=footer#weekly-gatherings` },
  ],
};

test("Services is a navigation alias without adding another page definition", () => {
  assert.equal(canonicalWebsiteNavigationPath("/services/"), "/programs");
  assert.equal(canonicalWebsiteNavigationPath("/programs"), "/programs");
  assert.equal(canonicalWebsiteNavigationPath("/"), "/");
  assert.equal(canonicalWebsiteNavigationPath("/services/private"), null);
  assert.equal(websitePageDefForPath("/services"), null, "page identity remains the existing Programs page");
});

test("resolved Services links stay on their app-host church and retain query, fragment, labels and copy", () => {
  const before = structuredClone(source);
  const resolved = normalizeWebsiteHrefs(source);
  const filtered = filterUnavailableSiteLinks(resolved, { slug, availablePaths: ["/", "/programs"] });
  for (const preview of [false, true]) {
    const result = rewriteSiteNavigation(filtered, { slug, basePath, preview });
    const previewQuery = preview ? "&preview=1" : "";
    assert.deepEqual(result, {
      ...source,
      links: [
        { label: "Services", href: `${basePath}/programs?from=menu${previewQuery}#weekly-gatherings` },
        { label: "Existing Services", href: `${basePath}/programs?from=footer${previewQuery}#weekly-gatherings` },
      ],
    });
  }
  assert.deepEqual(source, before, "saved church data is never mutated");
});

test("FaithForm and custom church hostnames use the same canonical destination", () => {
  const result = rewriteSiteNavigation(source, { slug, basePath: "", preview: true });
  assert.deepEqual(result, {
    ...source,
    links: [
      { label: "Services", href: "/programs?from=menu&preview=1#weekly-gatherings" },
      { label: "Existing Services", href: "/programs?from=footer&preview=1#weekly-gatherings" },
    ],
  });
});

test("Services aliases obey the existing Programs visibility and publication gates", () => {
  for (const status of ["published", "draft"]) {
    for (const visible of [false, true]) {
      for (const preview of [false, true]) {
        const availablePaths = availableWebsitePaths([
          { path: "/", status: "published", visibleTypes: ["hero"] },
          { path: "/programs", status, visibleTypes: visible ? ["programs_grid"] : [] },
        ], preview);
        const filtered = filterUnavailableSiteLinks(source, { slug, availablePaths }) as typeof source;
        assert.equal(filtered.links.length, visible && (preview || status === "published") ? 2 : 0);
        assert.equal(filtered.headline, source.headline);
        assert.equal(filtered.body, source.body);
      }
    }
  }
});

test("landing mode sends saved Services paths to the existing Programs section", () => {
  const input = { headline: "Services", links: [
    { label: "Services", href: "/services" },
    { label: "With campaign", href: `${basePath}/services?from=menu` },
    { label: "With fragment", href: "/services?from=footer#weekly-gatherings" },
  ] };
  const expected = { headline: "Services", links: [
    { label: "Services", href: "#programs" },
    { label: "With campaign", href: "?from=menu#programs" },
    { label: "With fragment", href: "?from=footer#weekly-gatherings" },
  ] };
  assert.deepEqual(normalizeLandingHrefs(input, slug), expected);
  const visible = normalizeLandingHrefs({ links: input.links.slice(0, 2) }, slug);
  assert.deepEqual(filterUnavailableSiteLinks(visible, { slug, availableAnchors: ["programs"] }), { links: expected.links.slice(0, 2) });
  assert.deepEqual(filterUnavailableSiteLinks(visible, { slug, availableAnchors: ["top"] }), { links: [] });
});

test("outside, foreign church and unrelated application destinations are untouched", () => {
  const input = { links: [
    "https://elsewhere.example/services", "https://faithform.io/services", "//elsewhere.example/services",
    "/sites/another-church/services", "/dashboard/services", "/services/private", "/give/somerset?amount=25#funds",
    "mailto:office@example.invalid", "tel:+15025550123", "#services", "/\\elsewhere.example/services",
  ].map(href => ({ label: "Saved label", href })) };
  assert.deepEqual(rewriteSiteNavigation(input, { slug, basePath, preview: true }), input);
  assert.deepEqual(filterUnavailableSiteLinks(input, { slug, availablePaths: ["/"] }), input);
  assert.deepEqual(normalizeLandingHrefs(input, slug), input);
});

test("landing campaign links retain authorized preview and remove saved preview flags for visitors", () => {
  const input = normalizeLandingHrefs({ links: [
    { label: "Services", href: "/services?from=menu" },
    { label: "Authored fragment", href: `${basePath}/services?from=footer&preview=1#weekly-gatherings` },
  ] }, slug);
  assert.deepEqual(rewriteSiteNavigation(input, { slug, basePath, preview: true }), { links: [
    { label: "Services", href: "?from=menu&preview=1#programs" },
    { label: "Authored fragment", href: "?from=footer&preview=1#weekly-gatherings" },
  ] });
  assert.deepEqual(rewriteSiteNavigation(input, { slug, basePath: "", preview: false }), { links: [
    { label: "Services", href: "?from=menu#programs" },
    { label: "Authored fragment", href: "?from=footer#weekly-gatherings" },
  ] });
});
