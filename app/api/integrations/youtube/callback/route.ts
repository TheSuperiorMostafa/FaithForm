import { NextResponse } from "next/server";

/** Legacy callback — forwards to the shared Google OAuth callback. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = new URL("/api/integrations/google/callback", url.origin);
  target.search = url.search;
  return NextResponse.redirect(target);
}
