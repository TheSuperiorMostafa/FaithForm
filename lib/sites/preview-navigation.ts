/** Keep the editor on its own deployment, even when its configured public host differs. */
export function sitePreviewHref(value: string): string {
  const url = new URL(value, "https://preview.invalid");
  url.searchParams.set("preview", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Ignore external destinations and other churches when synchronizing the editor. */
export function sitePreviewPath(initialHref: string, currentHref: string, origin: string): string | null {
  const initial = new URL(initialHref, origin);
  const current = new URL(currentHref, origin);
  const prefix = initial.pathname.match(/^\/sites\/[^/]+/)?.[0];
  if (!prefix || current.origin !== origin) return null;
  if (current.pathname !== prefix && !current.pathname.startsWith(`${prefix}/`)) return null;
  return current.pathname.slice(prefix.length).replace(/\/+$/, "") || "/";
}
