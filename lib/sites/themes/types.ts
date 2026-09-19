import type { SiteThemeRow } from "@/types/site";

/** A site format as code: the same shape as a `site_themes` row, plus its picker copy. */
export type SiteThemeDefinition = SiteThemeRow & { description: string };
