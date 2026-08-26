import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { selectChurchRequestSchema } from "@/lib/mobile/v1/contract";
import { setSelectedChurch } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * A preference, not authorization. Setting it proves only that a relationship
 * exists and is not blocked; every later read still checks access on its own.
 */
export const PUT = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = selectChurchRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Check the values you entered.");
    }
    return { data: await setSelectedChurch(userId, parsed.data.churchSlug) };
  },
);
