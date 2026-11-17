import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { rewriteChurchSite } from "@/lib/sites/tenant";
import { isChurchIconRequest } from "@/lib/sites/icon-paths";

export async function middleware(request: NextRequest) {
  // Browsers can request this before streamed page metadata arrives. Keep
  // the app icon on platform hosts and resolve church hosts before static files.
  if (isChurchIconRequest(request.nextUrl.pathname)) {
    return await rewriteChurchSite(request) ?? NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    "/favicon.ico",
    "/favicon-32.png",
    "/favicon-64.png",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/site-icons/:path*",
  ],
};
