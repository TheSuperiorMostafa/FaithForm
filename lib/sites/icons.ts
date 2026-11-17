import type { Metadata } from "next";

/** Override every inherited platform icon, including the browser shortcut. */
export function churchSiteIcons(profile: { name: string; logoUrl: string | null }): Metadata["icons"] {
  const logo = profile.logoUrl?.trim();
  // With no uploaded logo, use this church's initials instead of FaithForm branding.
  const initials = profile.name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0] ?? "").join("").toUpperCase() || "C";
  const escaped = initials.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
  const fallback = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#ffffff"/><text x="32" y="43" text-anchor="middle" font-family="sans-serif" font-size="28" font-weight="700" fill="#002d5f">${escaped}</text></svg>`)}`;
  const url = logo && (/^https?:\/\//i.test(logo) || /^\/(?!\/)/.test(logo)) ? logo : fallback;
  return { icon: [{ url }], shortcut: [{ url }], apple: [{ url }] };
}
