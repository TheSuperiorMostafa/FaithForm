import type { Metadata } from "next";
import { createHash } from "node:crypto";

/** One public icon source shared by page metadata and the browser fallback. */
export function churchSiteIconUrl(profile: { name: string; logoUrl: string | null }): string {
  const logo = profile.logoUrl?.trim();
  // With no uploaded logo, use this church's initials instead of FaithForm branding.
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] ?? "").join("").toUpperCase() || "C";
  const escaped = initials.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
  const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#ffffff"/><text x="32" y="43" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="700" fill="#002d5f">${escaped}</text></svg>`)}`;
  return logo && (/^https?:\/\//i.test(logo) || /^\/(?!\/)/.test(logo)) ? logo : fallback;
}

/** A new logo URL gets a new icon filename, without rebuilding the website. */
export function churchSiteIconRevision(profile: { name: string; logoUrl: string | null }): string {
  return createHash("sha256").update(churchSiteIconUrl(profile)).digest("hex").slice(0, 20);
}

/** Never turn arbitrary saved URLs into authenticated server-side downloads. */
export function churchSiteStoredLogo(raw: string, churchId: string): { bucket: string; path: string } | null {
  try {
    const url = new URL(raw);
    const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.origin !== storage.origin || url.username || url.password) return null;
    const match = /^\/storage\/v1\/object\/public\/(church-covers|branding-images|church-logos)\/(.+)$/.exec(url.pathname);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (/[\\%\u0000-\u001f\u007f]/.test(path)) return null;
    const segments = path.split("/");
    if (segments[0] !== churchId || segments.some(segment => !segment || segment === "." || segment === "..")) return null;
    return { bucket: match[1], path };
  } catch { return null; }
}

/** Override every inherited platform icon, including the browser shortcut. */
export function churchSiteIcons(
  profile: { name: string; logoUrl: string | null },
  site?: { basePath: string; churchId: string },
): Metadata["icons"] {
  const source = churchSiteIconUrl(profile);
  // Legacy externally hosted logos stay browser links, never server fetches.
  if (!site || (!source.startsWith("data:image/svg+xml,") && !churchSiteStoredLogo(source, site.churchId))) {
    return { icon: [{ url: source }], shortcut: [{ url: source }], apple: [{ url: source }] };
  }
  const prefix = `${site.basePath}/site-icons/${churchSiteIconRevision(profile)}`;
  return {
    icon: [
      { url: `${prefix}/icon-32.png`, type: "image/png", sizes: "32x32" },
      { url: `${prefix}/icon-64.png`, type: "image/png", sizes: "64x64" },
    ],
    shortcut: [{ url: `${prefix}/icon-32.png`, type: "image/png", sizes: "32x32" }],
    apple: [{ url: `${prefix}/apple-180.png`, type: "image/png", sizes: "180x180" }],
  };
}
