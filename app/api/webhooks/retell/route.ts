import { NextResponse } from "next/server";
import {
  type RetellCallPayload,
  upsertPhoneCallFromRetell,
} from "@/lib/integrations/retell-calls";
import { verifyRetellWebhook } from "@/lib/integrations/retell-webhook-verify";

type RetellWebhookPayload = {
  event: string;
  call: RetellCallPayload;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-retell-signature");

  if (!verifyRetellWebhook(rawBody, signature, process.env.RETELL_API_KEY)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RetellWebhookPayload;
  try {
    body = JSON.parse(rawBody) as RetellWebhookPayload;
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
