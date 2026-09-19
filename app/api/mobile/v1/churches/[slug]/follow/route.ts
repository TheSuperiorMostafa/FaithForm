import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { addChurch, leaveChurch } from "@/lib/faithform/relationships";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/**
 * Add this church as the person's church.
 *
 * One church per account: adding a church replaces the one they had. The path
 * still says "follow" because installed app builds call it by that name. The
 * join policy, the blocked check, idempotency and the audit trail all live in
 * the relationship state machine; this route adds nothing to them.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const relationship = await addChurch(userId, params.slug);
    return { data: { churchSlug: params.slug, state: relationship.state } };
  },
);

/** Remove this church. The person is back to having no church. */
export const DELETE = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    await leaveChurch(userId, params.slug);
    const state = await resolveRelationshipState(userId, params.slug);
    return { data: { churchSlug: params.slug, state } };
  },
);
