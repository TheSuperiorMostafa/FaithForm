import { churchIconResponse } from "@/lib/sites/icon-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ slug: string; revision: string; asset: string }> }) {
  const { slug, revision, asset } = await context.params;
  return churchIconResponse(request, slug, asset, revision);
}
