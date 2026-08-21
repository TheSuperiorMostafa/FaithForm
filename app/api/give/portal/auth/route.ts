import { NextResponse } from "next/server";
import { consumeMagicLinkToken } from "@/lib/giving/portal-session";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { assertRateLimit, getClientIp } from "@/lib/security/rate-limit";

/**
 * Magic-link landing route. Must be a Route Handler (not a Server Component)
 * so the session cookie can legally be set before redirecting to the portal.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  const token = url.searchParams.get("token")?.trim();
  const site = getCanonicalSiteUrl().replace(/\/$/, "");

  if (!slug || !token) {
    const fallback = slug
      ? `${site}/give/${slug}/portal`
      : `${site}`;
    return NextResponse.redirect(fallback);
  }

  const portalUrl = `${site}/give/${slug}/portal`;

  try {
    const rate = await assertRateLimit(
      `portal-auth:${getClientIp(request)}:${slug}`,
      { limit: 10, windowMs: 15 * 60 * 1000 },
    );
    if (!rate.ok) {
      return NextResponse.redirect(`${portalUrl}?error=invalid_link`);
    }
    const consumed = await consumeMagicLinkToken(token, slug);
    if (!consumed) {
      return NextResponse.redirect(`${portalUrl}?error=invalid_link`);
    }
    return NextResponse.redirect(portalUrl);
  } catch {
    console.error("[portal-auth] consume failed");
    return NextResponse.redirect(`${portalUrl}?error=link_failed`);
  }
}
