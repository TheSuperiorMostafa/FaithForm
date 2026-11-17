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
