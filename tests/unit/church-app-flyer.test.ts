import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_DOWNLOAD_PATH,
  appStoreDestination,
  contrastRatio,
  fileStem,
  isOwnStorageImage,
  flyerColors,
  flyerCopy,
  qrMatrix,
  qrPath,
  qrSvg,
} from "../../components/church-app/app-flyer-content";
import { marketingConfig } from "../../components/marketing/config";
import { renderAppFlyerPdf } from "../../components/church-app/app-flyer-pdf";
import { DEFAULT_BRAND } from "../../lib/branding/brand-colors";

const URL_IN_CODE = `https://faithform.io${APP_DOWNLOAD_PATH}`;

test("uses the church's app colors and falls back to FaithForm's own", () => {
  const forest = flyerColors("#1f4d3a", "#C9A227");
  assert.equal(forest.primary, "#1F4D3A");
  assert.equal(forest.accent, "#C9A227");
  assert.equal(forest.onPrimary, "#FFFFFF");
  assert.equal(forest.qrInk, "#1F4D3A");

  const unset = flyerColors(null, "not a color");
  assert.equal(unset.primary, DEFAULT_BRAND.primary);
  assert.equal(unset.accent, DEFAULT_BRAND.accent);
});

test("keeps a pale color scheme readable and the code scannable", () => {
  const pale = flyerColors("#F5E6A8", "#FFFFFF");
  assert.equal(pale.onPrimary, "#111827");
  // A pale primary would make a faint code, so it prints near-black instead.
  assert.equal(pale.qrInk, "#111827");
  assert.ok(contrastRatio(pale.qrInk, "#FFFFFF") >= 4.5);
  // A white accent would vanish on the white page.
  assert.notEqual(pale.accentOnWhite, "#FFFFFF");
  // A white accent on a pale band falls back to the band's text color.
  assert.equal(pale.accentOnPrimary, pale.onPrimary);
});

test("only promises app search when search can find the church", () => {
  const listed = flyerCopy({ churchName: " Grace Fellowship ", findableInSearch: true });
  assert.equal(listed.headline, "Our church has an app");
  assert.equal(listed.steps.length, 3);
  assert.match(listed.steps[2], /search for Grace Fellowship,/);

  const hidden = flyerCopy({ churchName: "Grace Fellowship", findableInSearch: false });
  assert.doesNotMatch(hidden.steps[2], /search/);
  assert.match(hidden.steps[2], /invitation link/);
});

test("names the app as it appears in the stores", () => {
  const copy = flyerCopy({ churchName: "Grace Fellowship", findableInSearch: true });
  for (const line of [...copy.steps.slice(1), copy.storeLine]) {
    assert.match(line, /FaithForm Connect/);
  }
});

test("sends iPhones and desktops to the App Store", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  assert.equal(appStoreDestination(iphone), marketingConfig.appStore);
  assert.equal(appStoreDestination(null), marketingConfig.appStore);
  const android = appStoreDestination("Mozilla/5.0 (Linux; Android 15; Pixel 9)");
  assert.equal(android, marketingConfig.androidStore ?? marketingConfig.appStore);
});

test("draws exactly the code's dark modules", () => {
  const { size, isDark } = qrMatrix(URL_IN_CODE);
  let dark = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) if (isDark(row, col)) dark += 1;
  }

  const path = qrPath(URL_IN_CODE);
  assert.equal(path.size, size);
  // Each run is "M{x} {y}h{w}v1h-{w}z"; their widths add up to the dark modules.
  const widths = [...path.d.matchAll(/M\d+ \d+h(\d+)v1h-\d+z/g)].map((m) => Number(m[1]));
  assert.equal(widths.reduce((sum, width) => sum + width, 0), dark);

  const svg = qrSvg(URL_IN_CODE, "#1f4d3a");
  assert.match(svg, /^<svg [^>]*viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /fill="#1F4D3A"/);
  assert.equal(svg.match(/viewBox="0 0 (\d+)/)?.[1], String(size + 8));
});

test("names downloads after the church", () => {
  assert.equal(fileStem("Grace Fellowship Church!"), "grace-fellowship-church");
  assert.equal(fileStem("Iglesia Nueva Visión"), "iglesia-nueva-vision");
  assert.equal(fileStem("   "), "church");
});

test("renders a one-page letter PDF", async () => {
  const pdf = await renderAppFlyerPdf({
    churchName: "Grace Fellowship",
    primaryColor: "#1F4D3A",
    accentColor: "#C9A227",
    logoPng: null,
    findableInSearch: true,
    downloadUrl: URL_IN_CODE,
  });
  const text = pdf.toString("latin1");
  assert.equal(text.slice(0, 5), "%PDF-");
  assert.match(text, /\/MediaBox \[0 0 612 792\]/);
  assert.equal(text.match(/\/Type \/Page\b/g)?.length, 1);
});

test("only fetches logos from FaithForm's own storage", () => {
  const base = "https://abc.supabase.co";
  assert.equal(isOwnStorageImage(`${base}/storage/v1/object/public/site-images/c1/logo.png`, base), true);
  assert.equal(isOwnStorageImage("https://example.com/logo.png", base), false);
  assert.equal(isOwnStorageImage(`http://abc.supabase.co/storage/v1/object/public/x.png`, base), false);
  assert.equal(isOwnStorageImage(`${base}/rest/v1/churches`, base), false);
  assert.equal(isOwnStorageImage("https://abc.supabase.co.evil.test/storage/v1/object/public/x.png", base), false);
  assert.equal(isOwnStorageImage(`${base}/storage/v1/object/public/x.png`, undefined), false);
});
