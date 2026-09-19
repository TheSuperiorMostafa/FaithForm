import { handleTakeEvent } from "@/lib/stream/recording-lifecycle";
import { handleRelayCall } from "@/lib/stream/recording-runtime";
import { takeEventBodySchema } from "@/lib/stream/relay-protocol";

export const dynamic = "force-dynamic";

/** An encoder connection (a "take") started or ended on the relay. */
export async function POST(request: Request) {
  return handleRelayCall(
    request,
    { route: "recording/take", schema: takeEventBodySchema },
    ({ deps, churchId, body }) => handleTakeEvent(deps, churchId, body),
  );
}
