import { NextResponse } from "next/server";
import {
  constructStripeEvent,
  processStripeEvent,
} from "@/lib/stripe/webhooks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let event;
  try {
    event = constructStripeEvent(rawBody, signature);
  } catch {
    console.error("[stripe webhook] signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Every line names the connected account: with one account per fund, the
  // same event type arrives from several accounts within seconds.
  const logContext = {
    account: typeof event.account === "string" ? event.account : null,
    type: event.type,
    event: event.id,
  };

  try {
    await processStripeEvent(event);
  } catch {
    console.error("[stripe webhook] processing deferred", logContext);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
