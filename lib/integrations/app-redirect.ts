import { NextResponse } from "next/server";

function getAppOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  const vercel = process.env.VERCEL_URL?.replace(/\/$/, "");
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;

  return "http://localhost:3000";
}

export function absoluteAppUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getAppOrigin()}${normalized}`;
}

export function redirectToApp(path: string): NextResponse {
  return NextResponse.redirect(absoluteAppUrl(path));
}

export function redirectToSettings(
  params: Record<string, string>,
  returnTo?: string,
): NextResponse {
  if (returnTo) {
    const base = absoluteAppUrl("/");
    const url = new URL(returnTo.startsWith("/") ? returnTo : `/${returnTo}`, base);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return NextResponse.redirect(url.toString());
  }
  const query = new URLSearchParams(params).toString();
  return redirectToApp(`/dashboard/settings?${query}`);
}
