import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canPreviewDraftSite, isPublicSitePublication } from "../../lib/sites/preview-access";

const churchId = "d1d65673-2d45-4825-9e6e-c2d85d4583fd";

test("anonymous publication requires both page and settings to be published", () => {
  assert.equal(isPublicSitePublication("published", true), true);
  assert.equal(isPublicSitePublication("published", false), false);
  assert.equal(isPublicSitePublication("published", null), false);
  assert.equal(isPublicSitePublication("draft", true), false);
});

test("draft website previews require a viewer from the same church with website access", () => {
  assert.equal(canPreviewDraftSite(churchId, null), false);
  assert.equal(
    canPreviewDraftSite(churchId, {
      churchId: "ffde855b-e97a-499f-aa75-d2fab09382b8",
      isAdmin: true,
      featurePermissions: ["website"],
    }),
    false,
  );
  assert.equal(
    canPreviewDraftSite(churchId, {
      churchId,
      isAdmin: false,
      featurePermissions: ["people"],
    }),
    false,
  );
  assert.equal(
    canPreviewDraftSite(churchId, {
      churchId,
      isAdmin: false,
      featurePermissions: ["website"],
    }),
    true,
  );
  assert.equal(
    canPreviewDraftSite(churchId, {
      churchId,
      isAdmin: true,
      featurePermissions: [],
    }),
    true,
  );
});

test("the public site checks page and metadata access on each request", () => {
  const page = readFileSync("app/sites/[slug]/page.tsx", "utf8");
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /generateMetadata[\s\S]*siteIsVisible\(bundle, query\.preview === "1"\)/);
  assert.match(page, /ChurchSitePage[\s\S]*siteIsVisible\(bundle, query\.preview === "1"\)/);
  const contact = readFileSync("app/api/sites/contact/route.ts", "utf8");
  assert.match(contact, /!target\.isPublished[\s\S]*canPreviewDraftSite\(target\.churchId, await getChurchAuth\(\)\)/);
});
