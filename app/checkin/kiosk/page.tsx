import type { Metadata } from "next";

import { KioskStation } from "@/components/checkin/kiosk-station";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check in",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The welcome-desk page.
 *
 * Like the projector page, it reads nothing on the server and embeds nothing.
 * All authority lives in a cookie scoped to `/api/checkin`, so this HTML is the
 * same for a paired tablet and an unpaired one — and the difference is decided
 * by the API, which re-checks the credential and the idle lock on every call.
 */
export default function CheckinKioskPage() {
  return <KioskStation />;
}
