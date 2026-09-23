import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { listRecurringGifts } from "@/lib/giving/v1/giving-recurring-service";

export const dynamic = "force-dynamic";

/**
 * This account's own recurring gifts at this church.
 *
 * Resolved through `giving_donor_links`, so a gift started on the web before
 * the app existed appears here too — and so a church that severs the link stops
 * this list in the same action that stops history and receipts.
 *
 * Never cached, for the same reason history is not: a list of what somebody
 * gives, and how often, is not a thing to leave sitting in a URL cache on a
 * shared device.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => ({
    data: { items: await listRecurringGifts({ userId, churchSlug: params.slug }) },
  }),
);
