import { NextResponse } from "next/server";
import { consumeMagicLinkToken } from "@/lib/giving/portal-session";
import { getCanonicalSiteUrl } from "@/lib/site-url";

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
    const consumed = await consumeMagicLinkToken(token, slug);
    if (!consumed) {
      return NextResponse.redirect(`${portalUrl}?error=invalid_link`);
    }
    return NextResponse.redirect(portalUrl);
  } catch (error) {
    console.error("[portal-auth] consume failed:", error);
    return NextResponse.redirect(`${portalUrl}?error=link_failed`);
  }
}
