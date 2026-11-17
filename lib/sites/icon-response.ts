import sharp from "sharp";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { CHURCH_ICON_SIZES } from "@/lib/sites/icon-paths";
import { churchSiteIconRevision, churchSiteIconUrl, churchSiteStoredLogo } from "@/lib/sites/icons";
import { isPublicSitePublication } from "@/lib/sites/preview-access";
import { getSiteBundle } from "@/lib/sites/queries";
import { createAdminClient } from "@/lib/supabase/admin";

const UNCACHED = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": UNCACHED } });
}

async function pngResponse(bytes: Buffer, size: number, cacheControl: string) {
  const png = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate().resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png().toBuffer();
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": cacheControl },
  });
}

/** Serve only published church artwork, never a caller-selected image URL. */
export async function churchIconResponse(request: Request, slug: string, asset: string, revision?: string): Promise<Response> {
  if (!Object.hasOwn(CHURCH_ICON_SIZES, asset) || (revision !== undefined && !/^[a-f0-9]{20}$/.test(revision))) {
    return notFound();
  }
  const bundle = await getSiteBundle(slug, "/");
  if (!bundle || !isPublicSitePublication(bundle.page.status, bundle.settings?.isPublished) ||
      !(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
    return notFound();
  }
  if (revision !== undefined && revision !== churchSiteIconRevision(bundle.profile)) return notFound();

  const size = CHURCH_ICON_SIZES[asset as keyof typeof CHURCH_ICON_SIZES];
  const cacheControl = revision === undefined ? UNCACHED : IMMUTABLE;
  const icon = churchSiteIconUrl(bundle.profile);
  const uploaded = churchSiteStoredLogo(icon, bundle.churchId);
  if (uploaded) {
    try {
      const client = createAdminClient({ signal: AbortSignal.timeout(5_000) });
      const { data, error } = await client.storage.from(uploaded.bucket).download(uploaded.path);
      if (!error && data && data.size <= 12 * 1024 * 1024) {
        return await pngResponse(Buffer.from(await data.arrayBuffer()), size, cacheControl);
      }
    } catch { /* A missing or unreadable logo uses this church's initials. */ }
    const initials = churchSiteIconUrl({ ...bundle.profile, logoUrl: null });
    // Do not permanently cache initials after a temporary upload/read failure.
    return pngResponse(Buffer.from(decodeURIComponent(initials.slice("data:image/svg+xml,".length))), size, UNCACHED);
  }
  if (icon.startsWith("data:image/svg+xml,")) {
    const svg = decodeURIComponent(icon.slice("data:image/svg+xml,".length));
    return pngResponse(Buffer.from(svg), size, cacheControl);
  }
  // Legacy external logos are followed by the browser; they are never fetched
  // with server credentials or used as arbitrary server-side fetch targets.
  return new Response(null, { status: 302, headers: {
    Location: new URL(icon, request.url).href,
    "Cache-Control": UNCACHED,
  } });
}
