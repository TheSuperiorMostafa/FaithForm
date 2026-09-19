import { handlePrepare } from "@/lib/stream/recording-lifecycle";
import { handleRelayCall } from "@/lib/stream/recording-runtime";
import { prepareBodySchema } from "@/lib/stream/relay-protocol";

export const dynamic = "force-dynamic";

/**
 * The relay closed some recording segments and asks what to do with each:
 * upload (with a one-off URL into private storage), already done, skip (not
 * part of any broadcast), or ask again later.
 */
export async function POST(request: Request) {
  return handleRelayCall(
    request,
    { route: "recording/prepare", schema: prepareBodySchema },
    ({ deps, churchId, body }) => handlePrepare(deps, churchId, body),
  );
}
