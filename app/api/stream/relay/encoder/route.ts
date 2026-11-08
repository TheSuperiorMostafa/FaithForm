import { encoderSignalSchema, handleEncoderSignal } from "@/lib/stream/encoder-automation";
import { handleRelayCall } from "@/lib/stream/recording-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleRelayCall(request, { route: "encoder", schema: encoderSignalSchema }, async ({ churchId, body }) => {
    await handleEncoderSignal(churchId, body);
    return { ok: true };
  });
}
