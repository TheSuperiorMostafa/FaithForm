import { NextResponse } from "next/server";
import { z } from "zod";
import { getChurchAuth } from "@/lib/auth/church";
import { getSubscriptionById } from "@/lib/queries/giving";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
} from "@/lib/stripe/giving";

const bodySchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

type RouteContext = { params: { id: string } };

export async function POST(request: Request, context: RouteContext) {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const sub = await getSubscriptionById(auth.churchId, context.params.id);
  if (!sub?.stripeAccountId) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  try {
    if (parsed.data.action === "pause") {
      await pauseSubscription(sub.stripeAccountId, sub.stripeSubscriptionId);
    } else if (parsed.data.action === "resume") {
      await resumeSubscription(sub.stripeAccountId, sub.stripeSubscriptionId);
    } else {
      await cancelSubscription(sub.stripeAccountId, sub.stripeSubscriptionId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
