import { handleHeartbeat } from "@/lib/stream/recording-lifecycle";
import { handleRelayCall } from "@/lib/stream/recording-runtime";
import { heartbeatBodySchema } from "@/lib/stream/relay-protocol";

export const dynamic = "force-dynamic";

/**
 * The recorder's own heartbeat: whether it is running, when it last closed a
 * segment, and what the encoder is sending. This is the provider-side half of
 * the evidence behind the dashboard's "Recording" indicator; the other half is
 * segments FaithForm has actually acknowledged.
 */
export async function POST(request: Request) {
  return handleRelayCall(
    request,
    { route: "heartbeat", schema: heartbeatBodySchema },
    ({ deps, churchId, body }) => handleHeartbeat(deps, churchId, body),
  );
}
