import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody, requireIdempotencyKey } from "@/lib/mobile/v1/protocol";
import { acceptInvitationRequestSchema } from "@/lib/mobile/v1/contract";
import { acceptJoinInvitation } from "@/lib/faithful/relationships";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Redeems a visitor invitation.
 *
 * Authentication is required *before* any relationship changes, which is why
 * the app holds an unredeemed token across the sign-in flow and posts it here
 * afterwards rather than acting on it first.
 *
 * Every check — purpose, church, expiry, revocation, single use, and blocked
 * status — happens inside Prompt 3's atomic consumer. This route only carries
 * the token there and reports what came back.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    // Redemption is retryable over a flaky connection, and a single-use token
    // must not be burned by a retry that never saw its response.
    requireIdempotencyKey(request);

    const parsed = acceptInvitationRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "That invitation link is not valid.");
    }

    const relationship = await acceptJoinInvitation(userId, parsed.data.token);

    const admin = createAdminClient();
    const { data: church } = await admin
      .from("churches")
      .select("slug, name")
      .eq("id", relationship.churchId)
      .maybeSingle();

    return {
      data: {
        churchSlug: (church?.slug as string) ?? "",
        churchName: (church?.name as string) ?? "",
        state: relationship.state,
      },
    };
  },
);
