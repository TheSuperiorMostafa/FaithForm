import type { SiteLink, SiteProfile, SiteSectionRow } from "@/types/site";

/**
 * How a church's public site is structured.
 *
 * - `landing` — everything on `/`, menu jumps with hashes (`#about`).
 * - `website` — home is a short page; About / Visit / Give / … are real paths.
 *
 * Default is always `landing` so existing published sites stay unchanged.
 */
export const SITE_LAYOUT_MODES = ["landing", "website"] as const;
export type SiteLayoutMode = (typeof SITE_LAYOUT_MODES)[number];

export function isSiteLayoutMode(value: unknown): value is SiteLayoutMode {
  return value === "landing" || value === "website";
}

export function parseSiteLayoutMode(value: unknown): SiteLayoutMode {
  return isSiteLayoutMode(value) ? value : "landing";
}

/**
 * Content sections that become their own page in website mode.
 * Order matches the usual landing scroll so consolidation stays familiar.
 */
export const WEBSITE_PAGE_DEFS = [
  { type: "about_text", path: "/about", title: "About", navLabel: "About", hash: "about" },
  { type: "vision_mission", path: "/vision", title: "Vision", navLabel: "Vision", hash: "vision" },
  { type: "staff_grid", path: "/staff", title: "Staff", navLabel: "Staff", hash: "staff" },
  { type: "programs_grid", path: "/programs", title: "Programs", navLabel: "Programs", hash: "programs" },
  { type: "visit_cta", path: "/visit", title: "Plan a visit", navLabel: "Visit", hash: "visit" },
  { type: "sermon_feed", path: "/sermons", title: "Sermons", navLabel: "Sermons", hash: "sermons" },
  { type: "give_cta", path: "/give", title: "Give", navLabel: "Give", hash: "give" },
  { type: "events_list", path: "/events", title: "Events", navLabel: "Events", hash: "events" },
] as const;

export type WebsitePageDef = (typeof WEBSITE_PAGE_DEFS)[number];

/** Chrome and home-only blocks that stay on `/` in website mode. */
export const WEBSITE_HOME_SECTION_TYPES = new Set([
  "site_nav",
  "hero",
  "service_times",
  "contact_band",
  "footer_map",
  "custom_embed",
]);

const PATH_BY_TYPE: Map<string, WebsitePageDef> = new Map(
  WEBSITE_PAGE_DEFS.map((def) => [def.type, def]),
);
const DEF_BY_PATH: Map<string, WebsitePageDef> = new Map(
  WEBSITE_PAGE_DEFS.map((def) => [def.path, def]),
);
const DEF_BY_HASH: Map<string, WebsitePageDef> = new Map(
  WEBSITE_PAGE_DEFS.map((def) => [def.hash, def]),
);

export function websitePageDefForType(type: string): WebsitePageDef | null {
  return PATH_BY_TYPE.get(type) ?? null;
}

export function websitePageDefForPath(path: string): WebsitePageDef | null {
  return DEF_BY_PATH.get(normalizeSitePath(path)) ?? null;
}

/** Turn App Router catch-all segments into a site_pages.path value. */
export function normalizeSitePath(segments: string[] | string | undefined | null): string {
  if (segments == null) return "/";
  if (typeof segments === "string") {
    const trimmed = segments.trim();
    if (!trimmed || trimmed === "/") return "/";
    return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") || "/" : `/${trimmed.replace(/\/+$/, "")}`;
  }
  if (segments.length === 0) return "/";
  return `/${segments.map((s) => s.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;
}

export function isWebsiteHomeSectionType(type: string): boolean {
  return WEBSITE_HOME_SECTION_TYPES.has(type);
}

/**
 * Menu / CTA / footer links for a given mode, based on which sections are
 * actually present and visible. Deterministic — no AI.
 */
export function buildSiteNavLinks(
  mode: SiteLayoutMode,
  sections: Pick<SiteSectionRow, "type" | "isVisible">[],
  profile?: Pick<SiteProfile, "givingEnabled" | "media">,
): SiteLink[] {
  const visible = new Set(
    sections.filter((s) => s.isVisible).map((s) => s.type),
  );

  const links: SiteLink[] = [];
  for (const def of WEBSITE_PAGE_DEFS) {
    if (def.type === "give_cta" && profile && !profile.givingEnabled) continue;
    if (def.type === "sermon_feed" && profile && profile.media.length === 0) {
      // Still allow if the section row exists and is visible (church turned it on).
      if (!visible.has(def.type)) continue;
    }
    if (!visible.has(def.type)) continue;
    // Visit is the primary CTA button, not a mid-menu item, matching generate.ts.
    if (def.type === "visit_cta") continue;
    links.push({
      label: def.navLabel,
      href: mode === "website" ? def.path : `#${def.hash}`,
    });
  }
  return links;
}

export function buildVisitCta(
  mode: SiteLayoutMode,
): { label: string; href: string; variant: "solid" } {
  return {
    label: "Visit",
    href: mode === "website" ? "/visit" : "#visit",
    variant: "solid",
  };
}

export function buildHeroActions(
  mode: SiteLayoutMode,
  hasSermons: boolean,
): { label: string; href: string; variant: "solid" | "outline" }[] {
  return [
    {
      label: "Plan your visit",
      href: mode === "website" ? "/visit" : "#visit",
      variant: "solid",
    },
    ...(hasSermons
      ? [
          {
            label: "Latest sermon",
            href: mode === "website" ? "/sermons" : "#sermons",
            variant: "outline" as const,
          },
        ]
      : []),
  ];
}

export function buildFooterExploreLinks(
  mode: SiteLayoutMode,
  sections: Pick<SiteSectionRow, "type" | "isVisible">[],
  profile?: Pick<SiteProfile, "givingEnabled" | "media">,
): SiteLink[] {
  const visible = new Set(
    sections.filter((s) => s.isVisible).map((s) => s.type),
  );
  const href = (hash: string, path: string) =>
    mode === "website" ? path : `#${hash}`;

  const links: SiteLink[] = [
    { label: "About us", href: href("about", "/about") },
  ];
  if (visible.has("sermon_feed") || (profile && profile.media.length > 0)) {
    links.push({ label: "Sermons", href: href("sermons", "/sermons") });
  }
  if (visible.has("give_cta") || profile?.givingEnabled) {
    links.push({ label: "Give", href: href("give", "/give") });
  }
  links.push({ label: "Plan a visit", href: href("visit", "/visit") });
  return links;
}

/**
 * Rewrite hash ↔ path hrefs inside section props (nav links, CTAs, footer).
 * Only touches string values that look like our known section anchors/paths.
 */
export function rewriteKnownHrefs(
  value: unknown,
  mode: SiteLayoutMode,
): unknown {
  if (typeof value === "string") {
    return rewriteOneHref(value, mode);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteKnownHrefs(item, mode));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewriteKnownHrefs(child, mode);
    }
    return out;
  }
  return value;
}

function rewriteOneHref(href: string, mode: SiteLayoutMode): string {
  const trimmed = href.trim();
  if (!trimmed) return href;

  if (mode === "website") {
    if (trimmed.startsWith("#")) {
      const hash = trimmed.slice(1);
      const def = DEF_BY_HASH.get(hash);
      if (def) return def.path;
      if (hash === "top" || hash === "top-hero" || hash === "times") return "/";
      if (hash === "contact" || hash === "footer") return "/";
    }
    return href;
  }

  // landing
  if (trimmed.startsWith("/") && trimmed !== "/") {
    const def = DEF_BY_PATH.get(trimmed);
    if (def) return `#${def.hash}`;
  }
  return href;
}

/** Landing scroll order used when collapsing website pages back onto `/`. */
export const LANDING_SECTION_ORDER = [
  "site_nav",
  "hero",
  "service_times",
  "about_text",
  "vision_mission",
  "staff_grid",
  "programs_grid",
  "events_list",
  "visit_cta",
  "sermon_feed",
  "give_cta",
  "contact_band",
  "footer_map",
  "custom_embed",
] as const;

export function sortSectionsForLanding<T extends { type: string; sortOrder: number }>(
  sections: T[],
): T[] {
  const rank = new Map(LANDING_SECTION_ORDER.map((type, i) => [type, i]));
  return sections
    .slice()
    .sort((a, b) => {
      const ra = rank.get(a.type as (typeof LANDING_SECTION_ORDER)[number]) ?? 100;
      const rb = rank.get(b.type as (typeof LANDING_SECTION_ORDER)[number]) ?? 100;
      if (ra !== rb) return ra - rb;
      return a.sortOrder - b.sortOrder;
    });
}

/**
 * Compose a website-mode subpage: home chrome around this page's content.
 * Home itself is returned unchanged.
 */
export function composeWebsiteSections(args: {
  path: string;
  homeSections: SiteSectionRow[];
  pageSections: SiteSectionRow[];
}): SiteSectionRow[] {
  const { path, homeSections, pageSections } = args;
  if (path === "/") return pageSections;

  const nav = homeSections.filter((s) => s.type === "site_nav");
  const content = pageSections.filter((s) => !isWebsiteHomeSectionType(s.type));
  const contact = homeSections.filter((s) => s.type === "contact_band");
  const footer = homeSections.filter((s) => s.type === "footer_map");

  // Prefer content from the page; if somehow empty, fall back to any
  // non-chrome rows still sitting on the page row.
  const body =
    content.length > 0
      ? content
      : pageSections.filter((s) => s.type !== "site_nav" && s.type !== "footer_map");

  const serviceTimes = path === "/visit"
    ? homeSections.filter((s) => s.type === "service_times")
    : [];

  // resolvePage sorts by sortOrder again. Borrowed home rows retain their old
  // positions, so explicitly number the composition rather than relying on
  // array order (a footer can otherwise appear before the page's body).
  return [...nav, ...body, ...serviceTimes, ...contact, ...footer].map((section, index) => ({
    ...section,
    sortOrder: index * 10,
  }));
}


/** Keep draft navigation inside the church's preview, including on subpages. */
export function rewritePreviewLinks(value: unknown, slug: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewritePreviewLinks(entry, slug));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (key === "href" && typeof entry === "string") {
      const [path] = entry.split(/[?#]/);
      if (path === "/" || websitePageDefForPath(path)) {
        const url = new URL(entry, "https://preview.invalid");
        url.pathname = `/sites/${encodeURIComponent(slug)}${url.pathname === "/" ? "" : url.pathname}`;
        url.searchParams.set("preview", "1");
        return [key, `${url.pathname}${url.search}${url.hash}`];
      }
    }
    return [key, rewritePreviewLinks(entry, slug)];
  }));
}
