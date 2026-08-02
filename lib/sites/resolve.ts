import type {
  ErasedSectionMaster,
  ResolvedPage,
  ResolvedSection,
} from "@/lib/sites/contract";
import type {
  SiteOverrideRow,
  SitePageRow,
  SiteProfile,
  SiteSectionRow,
  SiteSettingsRow,
  SiteThemeRow,
} from "@/types/site";

/**
 * The cascade resolver.
 *
 * For every field on every section, five layers are merged in order, last
 * value wins:
 *
 *   1. master defaults          -- the component's own baseline
 *   2. theme.section_defaults   -- the structural baseline for this look
 *   3. master.derive(profile)   -- content pulled from the church profile
 *   4. site_sections.props      -- the (regenerable) page config
 *   5. site_overrides.patch     -- hand edits, church then page then section
 *
 * Layers 4 and 5 are separate tables on purpose. The config in layer 4 gets
 * rewritten wholesale when a page is regenerated; keeping manual adjustments
 * in layer 5 is what lets them survive that.
 */

// ---------------------------------------------------------------------------
// DEEP MERGE
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `props` and `patch` are jsonb, and `JSON.parse('{"__proto__":{...}}')`
 * produces a real own property. Assigning it onto a plain object would walk
 * straight into the prototype setter and pollute every object in the process.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Merge `patch` over `base`.
 *
 * Two rules carry all the weight here:
 *
 * - **Arrays replace, never concatenate.** Overriding `staff` or `programs`
 *   means "this is the list now", not "add these to the derived list". Getting
 *   this wrong produces duplicated staff cards that look like a data bug and
 *   are miserable to trace back to the merge.
 *
 * - **`undefined` skips, `null` clears.** A patch that omits a key must not
 *   wipe the layer beneath it, but a patch that explicitly sets `null` is a
 *   deliberate "remove this", so it has to land.
 */
export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!patch) return base;

  const out: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (UNSAFE_KEYS.has(key)) continue;

    const current = out[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      out[key] = deepMerge(current, value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

// ---------------------------------------------------------------------------
// TOKENS
// ---------------------------------------------------------------------------

/** `--site-foo`, nothing else. */
const TOKEN_KEY = /^--site-[a-z0-9-]+$/i;

/**
 * A token value lands in a `style` attribute, so anything that could close the
 * declaration and start a new one has to go. `;` and `}` would let a church
 * brand token rewrite unrelated properties; `<` would let it break out of the
 * attribute entirely.
 */
const TOKEN_VALUE_FORBIDDEN = /[;{}<>]|javascript:|expression\s*\(|@import/i;

const MAX_TOKEN_VALUE = 200;

export function sanitizeTokens(
  raw: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    if (!TOKEN_KEY.test(key)) continue;

    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_VALUE) continue;
    if (TOKEN_VALUE_FORBIDDEN.test(trimmed)) continue;

    out[key] = trimmed;
  }

  return out;
}

/**
 * theme tokens <- church brand tokens <- church-scope override `tokens`.
 * Flat merge; tokens are a single-level string map by design so that a partial
 * brand override never has to restate the whole palette.
 */
export function resolveTokens(
  theme: SiteThemeRow,
  settings: SiteSettingsRow | null,
  churchOverride: SiteOverrideRow | null,
): Record<string, string> {
  return {
    ...sanitizeTokens(theme.tokens),
    ...sanitizeTokens(settings?.brandTokens),
    ...sanitizeTokens(asRecord(churchOverride?.patch?.tokens)),
  };
}

// ---------------------------------------------------------------------------
// CUSTOM CSS (escape hatch)
// ---------------------------------------------------------------------------

const MAX_CUSTOM_CSS = 20_000;

/**
 * The escape-hatch stylesheet is walled to one church by *where it loads* --
 * each church has its own host, so this CSS can only ever apply to their own
 * pages. What still has to be stripped is anything that escapes the `<style>`
 * element itself or reaches off-origin.
 */
export function sanitizeCustomCss(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const cleaned = raw
    .slice(0, MAX_CUSTOM_CSS)
    // Closing the style element would drop the rest into the document as HTML.
    .replace(/<\s*\/\s*style/gi, "")
    .replace(/<\s*script/gi, "")
    // Remote CSS would let the stylesheet change after review.
    .replace(/@import[^;]*;?/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/expression\s*\(/gi, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

// ---------------------------------------------------------------------------
// OVERRIDE LOOKUP
// ---------------------------------------------------------------------------

type OverrideIndex = {
  church: SiteOverrideRow | null;
  page: SiteOverrideRow | null;
  bySectionId: Map<string, SiteOverrideRow>;
};

function indexOverrides(
  overrides: SiteOverrideRow[],
  pageId: string,
): OverrideIndex {
  const index: OverrideIndex = {
    church: null,
    page: null,
    bySectionId: new Map(),
  };

  for (const row of overrides) {
    if (row.scope === "church") {
      index.church = row;
    } else if (row.scope === "page" && row.pageId === pageId) {
      index.page = row;
    } else if (row.scope === "section" && row.sectionId) {
      index.bySectionId.set(row.sectionId, row);
    }
  }

  return index;
}

/**
 * Church- and page-scope patches address sections by *type*, so "every hero on
 * this site" is expressible without knowing section ids. Section scope patches
 * the one instance directly.
 */
function scopedSectionPatch(
  override: SiteOverrideRow | null,
  type: string,
): Record<string, unknown> | null {
  const sections = asRecord(override?.patch?.sections);
  if (!sections) return null;
  return asRecord(sections[type]);
}

// ---------------------------------------------------------------------------
// SECTION RESOLUTION
// ---------------------------------------------------------------------------

function anchorFor(merged: Record<string, unknown>, type: string): string {
  const raw = merged.anchor;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim().replace(/[^a-z0-9_-]/gi, "");
  }
  return type.replace(/_/g, "-");
}

export function resolveSection(input: {
  row: SiteSectionRow;
  master: ErasedSectionMaster;
  theme: SiteThemeRow;
  profile: SiteProfile;
  overrides: OverrideIndex;
  index: number;
}): ResolvedSection {
  const { row, master, theme, profile, overrides, index } = input;

  let merged: Record<string, unknown> = { ...master.defaults };

  // 2. theme structural defaults for this section type
  merged = deepMerge(merged, asRecord(theme.sectionDefaults?.[row.type]));

  // 3. content derived from the existing church profile
  if (master.derive) {
    merged = deepMerge(merged, master.derive(profile));
  }

  // 4. the page config
  merged = deepMerge(merged, row.props);

  // 5. hand edits, widest scope first so the narrowest wins
  merged = deepMerge(merged, scopedSectionPatch(overrides.church, row.type));
  merged = deepMerge(merged, scopedSectionPatch(overrides.page, row.type));
  merged = deepMerge(merged, overrides.bySectionId.get(row.id)?.patch);

  return {
    type: row.type,
    content: merged,
    ctx: {
      id: row.id,
      anchor: anchorFor(merged, row.type),
      index,
    },
  };
}

// ---------------------------------------------------------------------------
// PAGE RESOLUTION
// ---------------------------------------------------------------------------

export function resolvePage(input: {
  page: SitePageRow;
  theme: SiteThemeRow;
  settings: SiteSettingsRow | null;
  sections: SiteSectionRow[];
  overrides: SiteOverrideRow[];
  profile: SiteProfile;
  registry: Record<string, ErasedSectionMaster>;
}): ResolvedPage {
  const { page, theme, settings, sections, overrides, profile, registry } = input;

  const index = indexOverrides(overrides, page.id);

  const resolved: ResolvedSection[] = [];
  let position = 0;

  const ordered = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const row of ordered) {
    if (!row.isVisible) continue;

    const master = registry[row.type];
    if (!master) {
      // An unknown type means the config references a component this build
      // does not ship -- a rolled-back deploy, or a typo in a seed. Skipping is
      // the only safe move: throwing would take the church's whole site down
      // over one bad row.
      console.warn(`[sites] unknown section type "${row.type}" (id ${row.id})`);
      continue;
    }

    resolved.push(
      resolveSection({
        row,
        master,
        theme,
        profile,
        overrides: index,
        index: position,
      }),
    );
    position += 1;
  }

  return {
    slug: profile.slug,
    title: page.title?.trim() || profile.name,
    metaDescription:
      page.metaDescription?.trim() || profile.tagline || profile.description || null,
    tokens: resolveTokens(theme, settings, index.church),
    customCss: sanitizeCustomCss(settings?.customCss),
    sections: resolved,
  };
}
