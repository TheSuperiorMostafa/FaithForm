import assert from "node:assert/strict";
import test from "node:test";
import { canViewChurchSitePage, churchSiteBasePath, rewriteSiteNavigation } from "@/lib/sites/public-navigation";

test("all six church pages stay on the same app-host website, including preview", () => {
  const paths = ["/give", "/programs", "/sermons", "/staff", "/vision", "/visit"];
  const input = paths.map(href => ({ href: `${href}?from=nav#details` }));
  assert.deepEqual(rewriteSiteNavigation(input, { slug: "grace", basePath: "/sites/grace", preview: false }), paths.map(path => ({ href: `/sites/grace${path}?from=nav#details` })));
  assert.deepEqual(rewriteSiteNavigation(input, { slug: "grace", basePath: "/sites/grace", preview: true }), paths.map(path => ({ href: `/sites/grace${path}?from=nav&preview=1#details` })));
  assert.deepEqual(rewriteSiteNavigation([{ href: "/sites/grace/staff?preview=1" }], { slug: "grace", basePath: "/sites/grace", preview: false }), [{ href: "/sites/grace/staff" }]);
});

test("custom domains use root links and external/giving/contact links retain their destinations", () => {
  assert.equal(churchSiteBasePath("grace", "localhost:3107", []), "/sites/grace");
  assert.equal(churchSiteBasePath("grace", "app.faithform.io", ["app.faithform.io"]), "/sites/grace");
  assert.equal(churchSiteBasePath("grace", "grace-church.org", ["faithform.io"]), "");
  const untouched = { body: "/give", links: ["https://other.org/staff", "//other.org/visit", "/give/grace", "mailto:office@example.org", "tel:+15025551234", "#form", "/sites/other/staff"].map(href => ({ href })) };
  assert.deepEqual(rewriteSiteNavigation(untouched, { slug: "grace", basePath: "/sites/grace", preview: true }), untouched);
  assert.deepEqual(rewriteSiteNavigation({ href: "/sites/grace/visit" }, { slug: "grace", basePath: "", preview: false }), { href: "/visit" });
});

test("unpublished church pages require authorized preview and published pages need published home", () => {
  const live = { previewRequested: false, previewAuthorized: false, published: true, homeStatus: "published", pageStatus: "published" };
  assert.equal(canViewChurchSitePage(live), true);
  assert.equal(canViewChurchSitePage({ ...live, pageStatus: "draft" }), false);
  assert.equal(canViewChurchSitePage({ ...live, homeStatus: "draft" }), false);
  assert.equal(canViewChurchSitePage({ ...live, published: false }), false);
  assert.equal(canViewChurchSitePage({ ...live, previewRequested: true }), false);
  assert.equal(canViewChurchSitePage({ ...live, pageStatus: "draft", published: false, previewRequested: true, previewAuthorized: true }), true);
});
