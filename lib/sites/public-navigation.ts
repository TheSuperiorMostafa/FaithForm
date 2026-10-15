import { websitePageDefForPath } from "@/lib/sites/layout-mode";

/** Direct app URLs need a church prefix; a church's own domain uses root paths. */
export function churchSiteBasePath(slug: string, host: string, platformHosts: string[]): string {
  const hostname = host.trim().toLowerCase().split(":")[0];
  const onPlatform = platformHosts.some(value => value?.toLowerCase().split(":")[0] === hostname)
    || hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".vercel.app");
  return onPlatform ? `/sites/${encodeURIComponent(slug)}` : "";
}

/** Only hrefs for church pages are scoped; copy, external sites and giving URLs stay intact. */
export function rewriteSiteNavigation(value: unknown, options: { slug: string; basePath: string; preview: boolean }): unknown {
  if (Array.isArray(value)) return value.map(entry => rewriteSiteNavigation(entry, options));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
    if (key === "href" && typeof entry === "string" && entry.startsWith("/") && !entry.startsWith("//")) {
      const url = new URL(entry, "https://navigation.invalid");
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
