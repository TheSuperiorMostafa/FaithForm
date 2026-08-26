import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { followChurch, leaveChurch } from "@/lib/faithful/relationships";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/**
 * Follow. Delegates entirely to Prompt 3's state machine — the join policy,
 * the blocked check, the idempotency and the audit trail all live there, and
 * this route adds nothing to them.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const relationship = await followChurch(userId, params.slug);
    return { data: { churchSlug: params.slug, state: relationship.state } };
  },
);

/** Unfollow. Same delegation. */
export const DELETE = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    await leaveChurch(userId, params.slug);
    const state = await resolveRelationshipState(userId, params.slug);
    return { data: { churchSlug: params.slug, state } };
  },
);
