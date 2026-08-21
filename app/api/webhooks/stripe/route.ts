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

  try {
    await processStripeEvent(event);
  } catch {
    console.error("[stripe webhook] processing deferred");
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
