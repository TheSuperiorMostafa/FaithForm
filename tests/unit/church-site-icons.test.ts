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

test("saved logos get separate versioned browser and Apple icon filenames", t => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test";
  t.after(() => { if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous; });
  const profile = { name: "Grace", logoUrl: "https://storage.example.test/storage/v1/object/public/church-logos/grace/logo.png?v=1" };
  type Image = { url: string; type: string; sizes: string };
  const icons = (basePath: string) => churchSiteIcons(profile, { basePath, churchId: "grace" }) as { icon: Image[]; shortcut: Image[]; apple: Image[] };
  const original = icons("");
  assert.match(original.icon[0].url, /^\/site-icons\/[a-f0-9]{20}\/icon-32\.png$/);
  assert.match(original.icon[1].url, /^\/site-icons\/[a-f0-9]{20}\/icon-64\.png$/);
  assert.equal(original.icon[0].type, "image/png");
  assert.equal(original.icon[0].sizes, "32x32");
  assert.equal(original.icon[1].sizes, "64x64");
  assert.deepEqual(original, icons(""));
  assert.deepEqual(original.shortcut[0], original.icon[0]);
  assert.match(original.apple[0].url, /\/apple-180\.png$/);
  assert.equal(original.apple[0].sizes, "180x180");
  profile.logoUrl = profile.logoUrl.replace("?v=1", "?v=2");
  assert.notEqual(icons("").icon[0].url, original.icon[0].url);
  assert.match(icons("/sites/grace").icon[0].url, /^\/sites\/grace\/site-icons\/[a-f0-9]{20}\/icon-32\.png$/);
});

test("church initials use the same PNG kit and external legacy logos remain browser links", () => {
  const initials = churchSiteIcons({ name: "Grace", logoUrl: null }, { basePath: "", churchId: "grace" }) as { apple: { url: string }[] };
  assert.match(initials.apple[0].url, /^\/site-icons\/[a-f0-9]{20}\/apple-180\.png$/);
  const external = "https://legacy.example.test/logo.jpg";
  assert.deepEqual(churchSiteIcons({ name: "Grace", logoUrl: external }, { basePath: "", churchId: "grace" }), {
    icon: [{ url: external }], shortcut: [{ url: external }], apple: [{ url: external }],
  });
});
