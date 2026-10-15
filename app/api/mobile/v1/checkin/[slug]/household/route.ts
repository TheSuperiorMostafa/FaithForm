import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { kidsCheckIn } from "@/lib/checkin/guardian-service";

export const dynamic = "force-dynamic";

// The caller supplies a church, never a household or guardian account id.
export const GET = authenticatedRoute({ cache: "private-no-store" }, async ({ userId, params }) => {
  return { data: await kidsCheckIn(userId, params.slug) };
});
