import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getOnboardingState } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/** What the app shows immediately after authentication. */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId }) => ({ data: await getOnboardingState(userId) }),
);
