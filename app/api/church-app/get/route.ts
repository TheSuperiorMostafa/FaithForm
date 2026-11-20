import { NextResponse } from "next/server";

import { appStoreDestination } from "@/components/church-app/app-flyer-content";

/**
 * Where every printed "Get the app" QR code lands.
 *
 * Public on purpose: whoever scans a church flyer is not signed in. It reads
 * nothing but the phone's user agent and only ever sends people to FaithForm's
 * own store listings, so it is not an open redirect and reveals no church data.
 */
export function GET(request: Request) {
  const destination = appStoreDestination(request.headers.get("user-agent"));
  return NextResponse.redirect(destination, {
    status: 302,
    headers: { "Cache-Control": "no-store", Vary: "User-Agent" },
  });
}
