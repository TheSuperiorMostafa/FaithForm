import sharp from "sharp";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { churchSiteIconUrl } from "@/lib/sites/icons";
import { isPublicSitePublication } from "@/lib/sites/preview-access";
import { getSiteBundle } from "@/lib/sites/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The browser's initial fallback must belong to this church, too. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const bundle = await getSiteBundle(slug, "/");
  if (!bundle || !isPublicSitePublication(bundle.page.status, bundle.settings?.isPublished) ||
      !(await isChurchFeatureEnabled(bundle.churchId, "website"))) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const icon = churchSiteIconUrl(bundle.profile);
  if (icon.startsWith("data:image/svg+xml,")) {
    // A PNG fallback also works in Safari versions without SVG favicon support.
    const svg = decodeURIComponent(icon.slice("data:image/svg+xml,".length));
    const png = await sharp(Buffer.from(svg)).resize(64, 64).png().toBuffer();
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }
  // Follow the published logo in the browser rather than fetching arbitrary
  // church-provided URLs on the server. No credentials enter this response.
  return new Response(null, { status: 302, headers: {
    Location: new URL(icon, request.url).href,
    "Cache-Control": "no-store",
  } });
}
