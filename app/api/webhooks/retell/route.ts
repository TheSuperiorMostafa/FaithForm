import { after, NextResponse } from "next/server";
import { isRealRetellPhoneCall } from "@/lib/integrations/retell-call-model";
import { scorePhoneCallIfNeeded } from "@/lib/integrations/score-phone-call";
import { resolveRetellApiKey } from "@/lib/integrations/retell-client";
import {
  resolveChurchIdFromRetellCall,
  type RetellCallPayload,
  upsertPhoneCallFromRetell,
} from "@/lib/integrations/retell-calls";
import { verifyRetellWebhook } from "@/lib/integrations/retell-webhook-verify";
import { createAdminClient } from "@/lib/supabase/admin";

type RetellWebhookPayload = {
  event: string;
  call: RetellCallPayload;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-retell-signature");

  // The signing key can be either FaithForm's shared account key or a
  // linked church's own key, and which one applies depends on the agent id
  // carried in the payload — so the church has to be resolved before we can
  // verify. Nothing here is trusted until verification passes below: this
  // only decides *which* key to check the signature against.
  let body: RetellWebhookPayload;
  try {
    body = JSON.parse(rawBody) as RetellWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.call?.call_id) {
    return NextResponse.json({ error: "call.call_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const churchId = await resolveChurchIdFromRetellCall(body.call, admin);
  const apiKey = await resolveRetellApiKey(churchId);

  if (!verifyRetellWebhook(rawBody, signature, apiKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (body.event !== "call_started" && body.event !== "call_ended" && body.event !== "call_analyzed") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!isRealRetellPhoneCall(body.call)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await upsertPhoneCallFromRetell(body.call, admin, { event: body.event, score: false });

    if (!result) {
      console.error(
        "[retell webhook] no church matched for call",
        body.call.call_id,
        body.call.agent_id,
      );
      return NextResponse.json({ ok: true, unmatched: true });
    }

    // Persist first, then score outside Retell's 10-second acknowledgement window.
    if (body.event !== "call_started" && body.call.transcript) {
      after(async () => {
        try { await scorePhoneCallIfNeeded(result.phoneCallId, { admin }); }
        catch (error) { console.error("[retell webhook] call scoring failed", error); }
      });
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
