import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { requestJoin } from "@/lib/faithful/relationships";

export const dynamic = "force-dynamic";

/**
 * Request to join.
 *
 * The outcome depends on the church's own policy, resolved server-side: `open`
 * joins immediately, `approval_required` returns `pending`, `invite_only` is
 * refused. The client renders whichever state comes back rather than deciding
 * in advance what will happen.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const relationship = await requestJoin(userId, params.slug);
    return { data: { churchSlug: params.slug, state: relationship.state } };
  },
);
