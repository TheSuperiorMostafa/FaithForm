import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio, createChurchAppTheme } from "../../lib/branding/church-theme";

test("church themes keep readable semantic colors in light and dark appearances", () => {
  const theme = createChurchAppTheme("#F5E942", "#2357D8");
  assert.ok(theme);
  assert.ok(contrastRatio(theme.light.primary, "#F8F7F4") >= 4.5);
  assert.ok(contrastRatio(theme.dark.primary, "#0A1628") >= 4.5);
  assert.ok(contrastRatio(theme.light.accent, theme.light.onAccent) >= 4.5);
  assert.ok(contrastRatio(theme.dark.accent, theme.dark.onAccent) >= 4.5);
});

test("church themes use canonical colors when none were selected", () => {
  assert.equal(createChurchAppTheme(null, null), null);
});
