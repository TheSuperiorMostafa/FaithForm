import { NextResponse } from "next/server";

import { SITE_LIVE_STATUS_TTL_SECONDS, getSiteLiveStatusBySlug } from "@/lib/sites/live-status";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Public, CDN-cacheable "is this church live" read for the website banner.
 *
 * Returns only `{ live, eventTitle }` — the same facts the public watch page
 * already shows — and is shared by every visitor for a few seconds, so the
 * banner's poll never fans out into per-visitor stream-table reads.
 */
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase() ?? "";
  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const status = await getSiteLiveStatusBySlug(slug);
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": `public, max-age=0, s-maxage=${SITE_LIVE_STATUS_TTL_SECONDS}, stale-while-revalidate=${SITE_LIVE_STATUS_TTL_SECONDS * 3}`,
    },
  });
}
