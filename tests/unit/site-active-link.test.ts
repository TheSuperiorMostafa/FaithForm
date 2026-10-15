import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentSiteLink } from "../../lib/sites/active-link";

test("current page matches public, site-prefixed and preview routes", () => {
  assert.equal(isCurrentSiteLink("/staff", "/staff"), true);
  assert.equal(isCurrentSiteLink("/sites/grace/staff?preview=1#team", "/staff", "/sites/grace"), true);
  assert.equal(isCurrentSiteLink("/sites/grace?preview=1", "/", "/sites/grace"), true);
  assert.equal(isCurrentSiteLink("/sites/graceful/staff", "/staff", "/sites/grace"), false);
  assert.equal(isCurrentSiteLink("/staff", "/vision"), false);
});

test("fixture paths are recognized only within website fixtures", () => {
  assert.equal(isCurrentSiteLink("/dev-site-preview/light?mode=website&path=%2Fstaff", "/staff"), true);
  assert.equal(isCurrentSiteLink("/dev-site-preview/light?path=%2Fstaff", "/staff"), false);
  assert.equal(isCurrentSiteLink("/unrelated?path=%2Fstaff", "/staff"), false);
});

test("landing links and external URLs never indicate a current page", () => {
  for (const href of ["#staff", "https://other.example/staff", "//other.example/staff", "mailto:staff@example.org", "/\\other.example/staff", "/\\["]) {
    assert.equal(isCurrentSiteLink(href, "/staff"), false);
  }
  assert.equal(isCurrentSiteLink("/staff"), false);
});
