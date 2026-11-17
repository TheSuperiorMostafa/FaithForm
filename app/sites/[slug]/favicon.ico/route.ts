import { churchIconResponse } from "@/lib/sites/icon-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The browser's initial fallback must belong to this church, too. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const size = new URL(request.url).searchParams.get("size");
  const asset = size === "32" ? "icon-32.png" : size === "180" ? "apple-180.png" : "icon-64.png";
  return churchIconResponse(request, slug, asset);
}
