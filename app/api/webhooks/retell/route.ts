import { NextResponse } from "next/server";
import {
  type RetellCallPayload,
  upsertPhoneCallFromRetell,
} from "@/lib/integrations/retell-calls";

type RetellWebhookPayload = {
  event: string;
  call: RetellCallPayload;
};

export async function POST(request: Request) {
  let body: RetellWebhookPayload;
  try {
    body = (await request.json()) as RetellWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.call?.call_id) {
    return NextResponse.json({ error: "call.call_id is required" }, { status: 400 });
  }

  if (body.event !== "call_ended" && body.event !== "call_analyzed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await upsertPhoneCallFromRetell(body.call);

    if (!result) {
      console.error(
        "[retell webhook] no church matched for call",
        body.call.call_id,
        body.call.agent_id,
      );
      return NextResponse.json({ ok: true, unmatched: true });
    }

    return NextResponse.json({
      ok: true,
      event: body.event,
      churchId: result.churchId,
      created: result.created,
    });
  } catch (error) {
    console.error("[retell webhook]", error);
    return NextResponse.json({ error: "Failed to record call" }, { status: 500 });
  }
}
