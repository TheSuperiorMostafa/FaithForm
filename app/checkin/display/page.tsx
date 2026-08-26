import type { Metadata } from "next";

import { CheckinDisplayBoard } from "@/components/checkin/display-board";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check in",
  // A projector page has no business in a search index, and a code on a screen
  // has no business in a referrer header.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The projector page.
 *
 * A server component that renders a client one and reads nothing. It has no
 * session, resolves no church, and touches no database — which is precisely
 * what makes it safe to leave open on a machine at the front of a room. The
 * capability lives in a cookie the API reads, so nothing sensitive is ever
 * embedded in the HTML this returns.
 */
export default function CheckinDisplayPage() {
  return <CheckinDisplayBoard />;
}
