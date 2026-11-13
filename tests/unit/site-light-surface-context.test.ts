import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { colorContrast } from "@/lib/branding/color-contrast";

const css = postcss.parse(readFileSync(new URL("../../app/sites/themes/light.css", import.meta.url), "utf8"));

type Pixel = [number, number, number];
function composite(color: number[], background: Pixel): Pixel {
  const alpha = color[3] ?? 1;
  return background.map((value, index) => color[index] * alpha + value * (1 - alpha)) as Pixel;
}
function hex(pixel: Pixel): string {
  return `#${pixel.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

test("Light layout containers inherit their containing section's foregrounds", () => {
  for (const selector of [".site-nav-inner", ".site-hero-body", ".site-section > *", ".site-footer-grid"]) {
    let found = false;
    css.walkRules(rule => {
      if (!rule.selectors.some(value => value === `[data-theme="light"] ${selector}`)) return;
      found = true;
      rule.walkDecls(declaration => {
        assert.ok(!/^--site-(fg|eyebrow)/.test(declaration.prop), `${selector} must not reset its section's foreground with ${declaration.prop}`);
      });
    });
    assert.ok(found, `${selector} remains a styled layout container`);
  }
});

test("Light's dark photo overlay uses fixed light text in both layouts, independently of custom ink", () => {
  const roles = new Map<string, string>();
  css.walkRules(rule => {
    if (rule.selector !== '[data-theme="light"] .site-hero') return;
    rule.walkDecls(declaration => { roles.set(declaration.prop, declaration.value); });
  });
  assert.equal(roles.get("--site-fg"), "#fff", "a light custom ink may derive dark on-ink text, but the photo overlay stays dark");
  assert.equal(roles.get("--site-eyebrow"), "#fff", "the small heading and headline accent share the dark-overlay context");
  assert.equal(roles.get("--site-fg-soft"), "rgba(255, 255, 255, 0.9)");
});

test("Light's floating timetable and solid cards explicitly own their surface foregrounds", () => {
  for (const selector of [".site-strip", ".site-card"]) {
    const roles = new Map<string, string>();
    css.walkRules(rule => {
      if (rule.selector !== `[data-theme="light"] ${selector}`) return;
      rule.walkDecls(declaration => { roles.set(declaration.prop, declaration.value); });
    });
    assert.equal(roles.get("background"), "var(--site-surface)");
    assert.equal(roles.get("--site-fg"), "var(--site-on-surface, var(--site-ink))");
    assert.equal(roles.get("--site-eyebrow"), "var(--site-on-surface-accent, var(--site-gold))");
  }
});

test("every Light hero gradient stop keeps text readable over a completely white photo or custom background", t => {
  const text: { role: string; rgba: number[] }[] = [];
  css.walkRules(rule => {
    if (rule.selector !== '[data-theme="light"] .site-hero') return;
    rule.walkDecls(declaration => {
      if (!/^--site-(fg(?:-soft|-faint)?|eyebrow)$/.test(declaration.prop)) return;
      const channels = declaration.value.match(/^rgba\(([^)]+)\)$/);
      assert.ok(channels || declaration.value === "#fff", `parse the actual ${declaration.prop} color`);
      text.push({ role: declaration.prop, rgba: channels ? channels[1].split(",").map(Number) : [255, 255, 255, 1] });
    });
  });
  assert.equal(text.length, 4);
  let checkedStops = 0;
  let minimumContrast = Infinity;
  css.walkRules(rule => {
    if (!rule.selectors.some(selector => /\.site-hero(?:-media::after)?$/.test(selector))) return;
    rule.walkDecls("background", declaration => {
      const stops = [...declaration.value.matchAll(/rgba\(([^)]+)\)/g)];
      assert.ok(stops.length > 0, "hero backgrounds must retain their dark overlay");
      assert.doesNotMatch(declaration.value, /\btransparent\b/, "no fully clear stop may expose a bright photo behind white text");
      for (const stop of stops) {
        const background = composite(stop[1].split(",").map(Number), [255, 255, 255]);
        for (const color of text) {
          const foreground = composite(color.rgba, background);
          const contrast = colorContrast(hex(foreground), hex(background));
          minimumContrast = Math.min(minimumContrast, contrast);
          assert.ok(contrast >= 4.5, `${color.role} has ${contrast.toFixed(2)}:1 over ${stop[0]} on white; normal text needs 4.5:1`);
        }
        checkedStops++;
      }
    });
  });
  assert.ok(checkedStops >= 6, "cover both the actual photo overlay and the no-photo background at every stop");
  t.diagnostic(`Minimum contrast ${minimumContrast.toFixed(2)}:1 across ${checkedStops} stops and all four text roles on white`);
});
