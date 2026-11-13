import { WEBSITE_PAGE_DEFS, websitePageDefForPath } from "@/lib/sites/layout-mode";

export type SiteNavigationPage = { path: string; status: string; visibleTypes: string[] };

/** Clearing a menu/button label hides that link instead of leaving an unnamed
 * keyboard target. The saved draft still retains the unfinished entry. */
export function hasUsableSiteLink<T extends {label:string;href:string}>(link:T|null|undefined):link is T {
  return Boolean(typeof link?.label === "string" && link.label.trim() && typeof link.href === "string" && link.href.trim() && link.href.trim() !== "#");
}

/** An off section is an off page; preview may include drafts but not hidden content. */
export function availableWebsitePaths(pages: SiteNavigationPage[], preview: boolean): string[] {
  return pages.filter(page => (preview || page.status === "published") &&
    (page.path === "/" || page.visibleTypes.includes(websitePageDefForPath(page.path)?.type ?? "")),
  ).map(page => page.path);
}

/**
 * Remove links to known church sections that are hidden, missing, or offline.
 * This runs on resolved content only: the church's saved menu and buttons stay
 * intact so bringing a section back also restores its links.
 */
export function filterUnavailableSiteLinks(value: unknown, options: {
  slug: string; availablePaths?: string[]; availableAnchors?: string[];
}): unknown {
  const paths = options.availablePaths ? new Set(options.availablePaths) : null;
  const anchors = options.availableAnchors ? new Set(options.availableAnchors) : null;
  const knownAnchors = new Set([
    "top", "top-hero", "times", "contact", "footer", "visit-form",
    ...WEBSITE_PAGE_DEFS.flatMap(def => [def.hash, def.type, def.type.replace(/_/g, "-")]),
  ]);
  function available(href: string): boolean {
    href = href.trim();
    if (href.startsWith("#")) return !anchors || !knownAnchors.has(href.slice(1)) || anchors.has(href.slice(1));
    if (!paths || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")) return true;
    const url = new URL(href, "https://navigation.invalid");
    const prefix = `/sites/${encodeURIComponent(options.slug)}`;
    const path = url.pathname === prefix ? "/" : url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : url.pathname;
    return path !== "/" && !websitePageDefForPath(path) || paths.has(path.replace(/\/+$/, "") || "/");
  }
  function visit(entry: unknown, root = false): unknown {
    if (Array.isArray(entry)) return entry.map(item => visit(item)).filter(item => item !== null);
    if (!entry || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (!root && typeof record.href === "string" && !available(record.href)) return null;
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, visit(child)]));
  }
  return visit(value, true);
}

/** Direct app URLs need a church prefix; a church's own domain uses root paths. */
export function churchSiteBasePath(slug: string, host: string, platformHosts: string[]): string {
  const hostnameOf = (value: string) => {
    try { return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase().replace(/\.$/, ""); }
    catch { return ""; }
  };
  const hostname = hostnameOf(host.trim());
  const onPlatform = platformHosts.some(value => value && hostnameOf(value) === hostname)
    || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  return onPlatform ? `/sites/${encodeURIComponent(slug)}` : "";
}

/** Only hrefs for church pages are scoped; copy, external sites and giving URLs stay intact. */
export function rewriteSiteNavigation(value: unknown, options: { slug: string; basePath: string; preview: boolean }): unknown {
  if (Array.isArray(value)) return value.map(entry => rewriteSiteNavigation(entry, options));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (key === "href" && typeof entry === "string" && entry.trim().startsWith("/") && !entry.trim().startsWith("//") && !entry.includes("\\")) {
      const url = new URL(entry.trim(), "https://navigation.invalid");
      const prefix = `/sites/${encodeURIComponent(options.slug)}`;
      const localPath = url.pathname === prefix ? "/" : url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : url.pathname;
      if (localPath === "/" || websitePageDefForPath(localPath)) {
        url.pathname = `${options.basePath}${localPath === "/" ? "" : localPath}` || "/";
        if (options.preview) url.searchParams.set("preview", "1");
        else url.searchParams.delete("preview");
        return [key, `${url.pathname}${url.search}${url.hash}`];
      }
    }
    return [key, rewriteSiteNavigation(entry, options)];
  }));
}

export function canViewChurchSitePage(input: {
  previewRequested: boolean; previewAuthorized: boolean;
  published: boolean; homeStatus: string; pageStatus: string;
}): boolean {
  if (input.previewRequested) return input.previewAuthorized;
  return input.published && input.homeStatus === "published" && input.pageStatus === "published";
}
