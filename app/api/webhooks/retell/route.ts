import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RetellCall = {
  call_id: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  disconnection_reason?: string;
  transcript?: string;
  call_analysis?: {
    user_sentiment?: string;
    call_summary?: string;
  };
  metadata?: Record<string, unknown>;
};

type RetellWebhookPayload = {
  event: string;
  call: RetellCall;
};

async function resolveChurchId(
  admin: ReturnType<typeof createAdminClient>,
  call: RetellCall,
): Promise<string | null> {
  const metadataChurchId = call.metadata?.church_id;
  if (typeof metadataChurchId === "string" && metadataChurchId) {
    return metadataChurchId;
  }

  if (!call.agent_id) return null;

  const { data } = await admin
    .from("voice_assistant_settings")
    .select("church_id")
    .eq("retail_ai_agent_id", call.agent_id)
    .maybeSingle();

  return (data?.church_id as string | undefined) ?? null;
}

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

  // Prefer call_analyzed for complete transcript + analysis; ignore other events.
  if (body.event !== "call_analyzed" && body.event !== "call_ended") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (body.event === "call_ended") {
    return NextResponse.json({ ok: true, deferred: true });
  }

  const admin = createAdminClient();
  const churchId = await resolveChurchId(admin, body.call);

  if (!churchId) {
    console.error("[retell webhook] could not resolve church for call", body.call.call_id);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  const { data: existing } = await admin
    .from("phone_calls")
    .select("id")
    .eq("retail_ai_call_id", body.call.call_id)
    .maybeSingle();

  const durationSeconds =
    body.call.start_timestamp && body.call.end_timestamp
      ? Math.max(
          0,
          Math.round((body.call.end_timestamp - body.call.start_timestamp) / 1000),
        )
      : null;

  const row = {
    church_id: churchId,
    retail_ai_call_id: body.call.call_id,
    caller_number: body.call.from_number ?? null,
    duration_seconds: durationSeconds,
    outcome: body.call.disconnection_reason ?? body.call.call_analysis?.call_summary ?? null,
    sentiment: body.call.call_analysis?.user_sentiment ?? null,
    transcript: body.call.transcript ?? null,
    call_type: "inbound",
    called_at: body.call.end_timestamp
      ? new Date(body.call.end_timestamp).toISOString()
      : new Date().toISOString(),
  };

  if (existing?.id) {
    await admin.from("phone_calls").update(row).eq("id", existing.id);
    return NextResponse.json({ ok: true, updated: true });
  }

  const { error } = await admin.from("phone_calls").insert(row);

  if (error) {
    console.error("[retell webhook]", error);
    return NextResponse.json({ error: "Failed to record call" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
