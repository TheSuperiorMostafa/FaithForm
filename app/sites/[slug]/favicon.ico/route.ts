import sharp from "sharp";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { churchSiteIconUrl } from "@/lib/sites/icons";
import { isPublicSitePublication } from "@/lib/sites/preview-access";
import { getSiteBundle } from "@/lib/sites/queries";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Only download this church's own public uploads through the storage SDK. */
function uploadedChurchLogo(raw: string, churchId: string): { bucket: string; path: string } | null {
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

async function pngResponse(bytes: Buffer) {
  const png = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate().resize(64, 64, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

/** The browser's initial fallback must belong to this church, too. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const bundle = await getSiteBundle(slug, "/");
  if (!bundle || !isPublicSitePublication(bundle.page.status, bundle.settings?.isPublished) ||
      !(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const icon = churchSiteIconUrl(bundle.profile);
  const uploaded = uploadedChurchLogo(icon, bundle.churchId);
  if (uploaded) {
    try {
      const { data, error } = await createAdminClient().storage.from(uploaded.bucket).download(uploaded.path);
      if (!error && data && data.size <= 12 * 1024 * 1024) {
        return await pngResponse(Buffer.from(await data.arrayBuffer()));
      }
    } catch { /* A missing or unreadable logo uses this church's initials. */ }
    const initials = churchSiteIconUrl({ ...bundle.profile, logoUrl: null });
    return pngResponse(Buffer.from(decodeURIComponent(initials.slice("data:image/svg+xml,".length))));
  }
  if (icon.startsWith("data:image/svg+xml,")) {
    // A PNG fallback also works in Safari versions without SVG favicon support.
    const svg = decodeURIComponent(icon.slice("data:image/svg+xml,".length));
    return pngResponse(Buffer.from(svg));
  }
  // Follow the published logo in the browser rather than fetching arbitrary
  // church-provided URLs on the server. No credentials enter this response.
  return new Response(null, { status: 302, headers: {
    Location: new URL(icon, request.url).href,
    "Cache-Control": "no-store",
  } });
}
