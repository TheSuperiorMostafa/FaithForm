import assert from "node:assert/strict";
import test from "node:test";
import { churchSiteIcons } from "@/lib/sites/icons";

test("each church's logo replaces every platform icon", () => {
  for (const name of ["Grace", "Somerset"]) {
    const logoUrl = `https://images.example.invalid/${name}.png`;
    assert.deepEqual(churchSiteIcons({ name, logoUrl }), {
      icon: [{ url: logoUrl }], shortcut: [{ url: logoUrl }], apple: [{ url: logoUrl }],
    });
  }
});

test("churches without an uploaded logo get safe church initials", () => {
  const icons = churchSiteIcons({ name: "Grace Community", logoUrl: null }) as { icon: { url: string }[] };
  const svg = decodeURIComponent(icons.icon[0].url.split(",")[1]);
  assert.match(svg, />GC<\/text>/);
  assert.doesNotMatch(JSON.stringify(icons), /favicon|FaithForm/);
  const unsafe = churchSiteIcons({ name: "<script &", logoUrl: "javascript:alert(1)" });
  assert.doesNotMatch(JSON.stringify(unsafe), /javascript:/);
});

test("saved logo changes version the same-origin favicon without changing a deployment", () => {
  const profile = { name: "Grace", logoUrl: "https://storage.example.test/logo.png?v=1" };
  const icons = (path: string) => churchSiteIcons(profile, path) as { icon: { url: string }[]; shortcut: { url: string }[]; apple: { url: string }[] };
  const original = icons("/favicon.ico");
  assert.match(original.icon[0].url, /^\/favicon\.ico\?v=[a-f0-9]{20}$/);
  assert.deepEqual(original, icons("/favicon.ico"));
  assert.deepEqual(original.icon, original.shortcut);
  assert.deepEqual(original.icon, original.apple);
  profile.logoUrl = "https://storage.example.test/logo.png?v=2";
  assert.notEqual(icons("/favicon.ico").icon[0].url, original.icon[0].url);
  assert.match(icons("/sites/grace/favicon.ico").icon[0].url, /^\/sites\/grace\/favicon\.ico\?v=/);
});
