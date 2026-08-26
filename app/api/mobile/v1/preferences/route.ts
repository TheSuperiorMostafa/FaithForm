import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { setPreferenceRequestSchema } from "@/lib/mobile/v1/contract";
import { listPreferences, setPreference } from "@/lib/faithful/push/installations";

export const dynamic = "force-dynamic";

export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId }) => ({ data: { items: await listPreferences(userId) } }),
);

/**
 * Sets one topic preference for one church.
 *
 * Refused unless the account holds a usable relationship with that church —
 * otherwise this endpoint would report whether a private church exists.
 */
export const PUT = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = setPreferenceRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Check the values you entered.");
    }
    return { data: await setPreference(userId, parsed.data) };
  },
);
