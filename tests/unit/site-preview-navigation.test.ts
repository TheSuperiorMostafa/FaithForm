import assert from "node:assert/strict";
import test from "node:test";
import { sitePreviewHref, sitePreviewPath } from "../../lib/sites/preview-navigation";

test("preview uses the dashboard deployment and retains page, query and anchor", () => {
  assert.equal(sitePreviewHref("https://faithform.io/sites/grace/give?from=home#ways"), "/sites/grace/give?from=home&preview=1#ways");
  assert.equal(sitePreviewHref("/sites/grace?preview=1"), "/sites/grace?preview=1");
});

test("editor follows navigation within the same church", () => {
  const origin = "https://staging.faithform.io";
  assert.equal(sitePreviewPath("/sites/grace?preview=1", `${origin}/sites/grace/sermons?preview=1`, origin), "/sermons");
  assert.equal(sitePreviewPath("/sites/grace/visit?preview=1", `${origin}/sites/grace/`, origin), "/");
});

test("external links, unrelated app pages and other churches do not select editor pages", () => {
  const origin = "https://staging.faithform.io";
  for (const href of ["https://other.example/sites/grace/give", `${origin}/sites/graceful/give`, `${origin}/sites/another/give`, `${origin}/give/grace`]) {
    assert.equal(sitePreviewPath("/sites/grace", href, origin), null);
  }
});
