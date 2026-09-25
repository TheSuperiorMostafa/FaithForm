import { NextResponse } from "next/server";
import { z } from "zod";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { getSubscriptionById } from "@/lib/queries/giving";
import { featureAccessDenied } from "@/lib/features/guard";
import { recurringErrorMessage } from "@/lib/giving/provider-errors";
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
    return NextResponse.json(
      { error: "We couldn't read that request. Refresh the page and try again." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "We couldn't tell what to do with this recurring gift. Refresh the page and try again." },
      { status: 400 },
    );
  }

  const sub = await getSubscriptionById(auth.churchId, id);
  if (!sub?.stripeAccountId) {
    return NextResponse.json(
      { error: "We couldn't find that recurring gift. Refresh the page and try again." },
      { status: 404 },
    );
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
    console.error("[giving] recurring gift action failed", parsed.data.action, id, err);
    return NextResponse.json(
      { error: recurringErrorMessage(parsed.data.action, err) },
      { status: 500 },
    );
  }
}
