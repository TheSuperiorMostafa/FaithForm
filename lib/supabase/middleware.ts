import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { DEFAULT_PRODUCTION_SITE_URL } from "@/lib/site-url";
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
  const giveRewrite = rewriteGiveSubdomain(request);
  if (giveRewrite) return giveRewrite;

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (request.nextUrl.pathname.startsWith("/onboarding")) {
    return response;
  }

  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";

    if (!user) {
      return NextResponse.redirect(url);
    }

    if (isBootstrapSuperAdminEmail(user.email)) {
      return response;
    }

    const admin = createAdminClientOrNull();
    if (!admin) {
      return NextResponse.redirect(url);
    }

    const { data, error } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !data?.user_id) {
      return NextResponse.redirect(url);
    }
  }

  return response;
}
