import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { consentRequestSchema } from "@/lib/mobile/v1/contract";
import { applyConsent } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * Records terms, privacy, and automatic-attendance consent.
 *
 * Prompt 3 owns the storage and Prompt 6 owns what consent permits. This route
 * records a choice and collects no location of any kind.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = consentRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Check the values you entered.", {
        fields: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          issue: issue.code,
        })),
      });
    }
    return { data: await applyConsent(userId, parsed.data) };
  },
);
