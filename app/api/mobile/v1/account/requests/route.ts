import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody, requireIdempotencyKey } from "@/lib/mobile/v1/protocol";
import { accountActionRequestSchema } from "@/lib/mobile/v1/contract";
import { submitAccountRequest } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * Requests an export or a deletion.
 *
 * Retryable, so an idempotency key is mandatory: a phone that loses the
 * response and tries again must join the existing request rather than start a
 * second one. Prompt 3's storage enforces that with a unique key per
 * (account, kind, idempotency key).
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const idempotencyKey = requireIdempotencyKey(request);
    const parsed = accountActionRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Choose export or deletion.");
    }
    return {
      data: await submitAccountRequest(userId, parsed.data.kind, idempotencyKey),
    };
  },
);
