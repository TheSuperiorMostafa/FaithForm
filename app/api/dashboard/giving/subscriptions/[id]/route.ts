import { NextResponse } from "next/server";
import { z } from "zod";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { getSubscriptionById } from "@/lib/queries/giving";
import { featureAccessDenied } from "@/lib/features/guard";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
} from "@/lib/stripe/giving";

const bodySchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let auth;
  try {
    auth = await requireChurchAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Forbidden") return forbiddenResponse();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureAccessDenied("giving");
  if (denied) return denied;

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

  const sub = await getSubscriptionById(auth.churchId, id);
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

    await logAdminAction({
      churchId: auth.churchId,
      taskName: `${parsed.data.action} subscription ${id}`,
      triggerSource: `admin:subscription:${parsed.data.action}:${id}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
