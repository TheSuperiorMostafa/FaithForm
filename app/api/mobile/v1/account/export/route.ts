import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { buildAccountExport } from "@/lib/mobile/v1/account-service";

export const dynamic = "force-dynamic";

/**
 * The account's own data.
 *
 * Prompt 3 decides what this contains; the boundary here is that it is
 * never cached and never shared — an export is the most account-specific
 * response the API produces.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId }) => ({ data: await buildAccountExport(userId) }),
);
