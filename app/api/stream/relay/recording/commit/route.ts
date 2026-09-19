import { handleCommit } from "@/lib/stream/recording-lifecycle";
import { handleRelayCall } from "@/lib/stream/recording-runtime";
import { commitBodySchema } from "@/lib/stream/relay-protocol";

export const dynamic = "force-dynamic";

/** The relay uploaded these. Idempotent: only pending rows move. */
export async function POST(request: Request) {
  return handleRelayCall(
    request,
    { route: "recording/commit", schema: commitBodySchema },
    ({ deps, churchId, body }) => handleCommit(deps, churchId, body),
  );
}
