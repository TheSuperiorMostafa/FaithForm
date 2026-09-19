import { NextResponse } from "next/server";

import { MAX_WEBHOOK_BYTES, handleChatWebhook } from "@/lib/messaging/webhooks";

/**
 * Inbound events from the chat provider (Stream).
 *
 * Nothing is trusted until `handleChatWebhook` has checked the app key, the
 * HMAC signature over the raw body (constant time), and the event id for
 * replay. The body is read as bytes, bounded, before anything parses it.
 * Responses carry no detail beyond a code, so a prober learns nothing.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ received: false, error: "too_large" }, { status: 413 });
  }
  const rawBody = Buffer.from(await request.arrayBuffer());
  const result = await handleChatWebhook({ rawBody, headers: request.headers });
  return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
