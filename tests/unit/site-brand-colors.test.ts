import assert from "node:assert/strict";
import test from "node:test";
import { resolveTokens } from "@/lib/sites/resolve";
import { CODE_SITE_THEMES } from "@/lib/sites/themes";
import type { SiteSettingsRow } from "@/types/site";

function settings(brandTokens: Record<string, string>): SiteSettingsRow {
  return { themeKey: "grace", brandTokens, customCss: null, contactEmail: null, isPublished: true, layoutMode: "website" };
}

test("each default website theme keeps its original palette", () => {
  for (const theme of Object.values(CODE_SITE_THEMES)) {
    assert.deepEqual(resolveTokens(theme, settings({}), null), theme.tokens);
  }
});

test("changing the main dark color also changes footer and map shades in every theme", () => {
  for (const theme of Object.values(CODE_SITE_THEMES)) {
    const tokens = resolveTokens(theme, settings({ "--site-ink": "#6B1E2E" }), null);
    assert.equal(tokens["--site-ink"], "#6B1E2E");
    assert.equal(tokens["--site-ink-strong"], "color-mix(in srgb, #6B1E2E 78%, #000)");
    assert.equal(tokens["--site-ink-soft"], "color-mix(in srgb, #6B1E2E 86%, #fff)");
    assert.equal(tokens["--site-accent-ink"], "#6B1E2E");
    assert.equal(tokens["--site-canvas"], theme.tokens["--site-canvas"]);
  }
});

test("a changed page background carries through to the light footer", () => {
  const tokens = resolveTokens(CODE_SITE_THEMES.light, settings({ "--site-canvas": "#FCE8EC" }), null);
  assert.equal(tokens["--site-canvas-alt"], "color-mix(in srgb, #FCE8EC 96%, var(--site-ink))");
});

test("explicit shade overrides keep their precedence over derived brand colors", () => {
  const tokens = resolveTokens(CODE_SITE_THEMES.grace,
    settings({ "--site-ink": "#6B1E2E", "--site-ink-strong": "#180A0E" }),
    { scope: "church", pageId: null, sectionId: null, patch: { tokens: { "--site-ink": "#1F4D3A", "--site-canvas": "#FEFFF0", "--site-canvas-alt": "#EEF0DF" } } });
  assert.equal(tokens["--site-ink"], "#1F4D3A");
  assert.equal(tokens["--site-ink-strong"], "#180A0E");
  assert.equal(tokens["--site-ink-soft"], "color-mix(in srgb, #1F4D3A 86%, #fff)");
  assert.equal(tokens["--site-canvas-alt"], "#EEF0DF");
});

test("rejected brand tokens cannot influence dependent footer shades", () => {
  const theme = CODE_SITE_THEMES.grace;
  const tokens = resolveTokens(theme, settings({ "--site-ink": "red; background: url(evil)", "--site-canvas": "<style>" }), null);
  assert.deepEqual(tokens, theme.tokens);
});
