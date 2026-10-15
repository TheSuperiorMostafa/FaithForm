/** Resolve a local page link across custom domains, app paths, and theme fixtures. */
export function sitePathForHref(href: string, websiteBasePath = ""): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(href, "https://site.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://site.invalid") return null;
  let path = url.pathname;
  if (path.startsWith("/dev-site-preview/")) {
    if (url.searchParams.get("mode") !== "website") return null;
    path = url.searchParams.get("path") || "/";
  } else if (websiteBasePath && (path === websiteBasePath || path.startsWith(`${websiteBasePath}/`))) {
    path = path.slice(websiteBasePath.length) || "/";
  }
  return path.replace(/\/+$/, "") || "/";
}

/** Landing anchors and external URLs never indicate a current page. */
export function isCurrentSiteLink(href: string, websitePath?: string, websiteBasePath = ""): boolean {
  return Boolean(websitePath && sitePathForHref(href, websiteBasePath) === (websitePath.replace(/\/+$/, "") || "/"));
}
