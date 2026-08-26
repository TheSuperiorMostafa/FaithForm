import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getChurchChooser } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/** The churches this account may switch between. Left and blocked are absent. */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId }) => ({ data: { items: await getChurchChooser(userId) } }),
);
