import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { mustChangePassword } from "@/lib/auth/temp-password";
import { DEFAULT_PRODUCTION_SITE_URL } from "@/lib/site-url";
import { rewriteChurchSite } from "@/lib/sites/tenant";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

function rewriteGiveSubdomain(request: NextRequest): NextResponse | null {
  const giveHost = process.env.NEXT_PUBLIC_GIVE_HOST?.trim();
  if (!giveHost) return null;

  const host = request.headers.get("host")?.split(":")[0] ?? "";
  if (host !== giveHost) return null;

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return null;
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    const home =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
      DEFAULT_PRODUCTION_SITE_URL;
    return NextResponse.redirect(new URL(home, request.url));
  }

  const slug = segments[0];
  const rest = segments.slice(1);
  const subpath = rest.length > 0 ? `/${rest.join("/")}` : "";
  const url = request.nextUrl.clone();
  url.pathname = `/give/${slug}${subpath}`;
  return NextResponse.rewrite(url);
}

export async function updateSession(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const { assertProductionEnv, ProductionEnvError } = await import(
      "@/lib/env/production"
    );
    try {
      assertProductionEnv();
    } catch (error) {
      const failedChecks =
        error instanceof ProductionEnvError
          ? error.failedChecks.join(", ")
          : "unknown";
      console.error(
        `[security] production environment validation failed: ${failedChecks}`,
      );
      return NextResponse.json(
        { error: "Service unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const giveRewrite = rewriteGiveSubdomain(request);
  if (giveRewrite) return giveRewrite;

  // Church websites resolve before the auth client is built. They are public
  // pages served on someone else's domain, so making every visitor pay for a
  // Supabase session round trip would be pure waste.
  const siteRewrite = await rewriteChurchSite(request);
  if (siteRewrite) return siteRewrite;

  let pendingCookies: {
    name: string;
    value: string;
    options: CookieOptions;
  }[] = [];
  let pendingHeaders: Record<string, string> = {};

  const withSessionState = (nextResponse: NextResponse) => {
    pendingCookies.forEach(({ name, value, options }) =>
      nextResponse.cookies.set(name, value, options),
    );
    Object.entries(pendingHeaders).forEach(([name, value]) =>
      nextResponse.headers.set(name, value),
    );
    return nextResponse;
  };

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          pendingCookies = cookiesToSet;
          pendingHeaders = headers;
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = withSessionState(NextResponse.next({ request }));
        },
      },
    },
  );

  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsError ? null : data?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const userEmail = typeof claims?.email === "string" ? claims.email : null;
  const userMetadata = claims?.user_metadata as
    | Record<string, unknown>
    | null
    | undefined;

  if (request.nextUrl.pathname.startsWith("/onboarding")) {
    return response;
  }

  if (!userId && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withSessionState(NextResponse.redirect(url));
  }

  // Someone signed in with the temporary password an admin handed them gets no
  // further than the set-password screen. Scoped to the signed-in areas so a
  // public giving or watch page still renders for them.
  const isSignedInArea =
    request.nextUrl.pathname.startsWith("/dashboard") ||
    request.nextUrl.pathname.startsWith("/admin");

  if (
    userId &&
    isSignedInArea &&
    mustChangePassword(userMetadata ?? null)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/set-password";
    url.search = "";
    return withSessionState(NextResponse.redirect(url));
  }

  if (request.nextUrl.pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";

    if (!userId) {
      return withSessionState(NextResponse.redirect(url));
    }

    if (isBootstrapSuperAdminEmail(userEmail)) {
      return response;
    }

    const admin = createAdminClientOrNull();
    if (!admin) {
      return withSessionState(NextResponse.redirect(url));
    }

    const { data, error } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data?.user_id) {
      return withSessionState(NextResponse.redirect(url));
    }
  }

  return response;
}
