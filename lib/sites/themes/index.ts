import { classicTheme, graceTheme } from "@/lib/sites/themes/grace";
import { lightTheme } from "@/lib/sites/themes/light";
import type { SiteThemeDefinition } from "@/lib/sites/themes/types";
import { woodTheme } from "@/lib/sites/themes/wood";

/**
 * Every shipped site format, as code. Production reads `site_themes`; this is
 * for the dev preview and for tests that check each migration seeds exactly
 * what its format declares.
 */
export const CODE_SITE_THEMES: Record<string, SiteThemeDefinition> = Object.fromEntries(
  [graceTheme, classicTheme, woodTheme, lightTheme].map((theme) => [theme.key, theme]),
);
