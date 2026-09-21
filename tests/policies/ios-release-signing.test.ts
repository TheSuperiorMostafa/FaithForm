import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const release = readFileSync("apps/faithform-ios/App/Configuration/Release.xcconfig", "utf8");

test("the store identity overrides personal settings included by Base.xcconfig", () => {
  const include = release.indexOf('#include "Base.xcconfig"');
  assert.ok(include >= 0);
  for (const assignment of [
    "FAITHFORM_BUNDLE_ID = io.faithform.app",
    "FAITHFORM_BUNDLE_ID_SUFFIX =",
    "PRODUCT_BUNDLE_IDENTIFIER = $(FAITHFORM_BUNDLE_ID)",
    "DEVELOPMENT_TEAM = BPKHRJ24C7",
  ]) {
    assert.ok(release.indexOf(assignment) > include, `${assignment} must follow the local-config include`);
  }
  assert.equal(release.match(/^#include.*$/gm)?.length, 1, "no later include may replace the store identity");
});

test("the release keeps production services and disables debug controls", () => {
  assert.match(release, /^FAITHFORM_ENVIRONMENT_KEY = production$/m);
  assert.match(release, /^FAITHFORM_API_ORIGIN = https:\/\$\(\)\/faithform\.io$/m);
  assert.match(release, /^FAITHFORM_ALLOW_DEBUG_CONTROLS = NO$/m);
});

test("the App Store export uses the same team without uploading automatically", () => {
  const options = readFileSync("apps/faithform-ios/ExportOptions-AppStore.plist", "utf8");
  assert.match(options, /<key>method<\/key>\s*<string>app-store-connect<\/string>/);
  assert.match(options, /<key>teamID<\/key>\s*<string>BPKHRJ24C7<\/string>/);
  assert.match(options, /<key>destination<\/key>\s*<string>export<\/string>/);
});
