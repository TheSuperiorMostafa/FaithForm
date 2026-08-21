import { NextResponse } from "next/server";
import { z } from "zod";
import { isStripeConfigured } from "@/lib/stripe/client";
import { getDonorPortalSession } from "@/lib/giving/portal-session";
import { createAuthorizedBillingPortal } from "@/lib/giving/portal-billing";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

const bodySchema = z.object({
  slug: z.string().min(1),
});

const GENERIC_ERROR = "The billing portal is unavailable for this session.";

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
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

  const ip = getClientIp(request);
  const rate = await assertRateLimit(`portal-billing:${ip}:${parsed.data.slug}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.ok) {
    return rateLimitResponse(rate.retryAfterSeconds);
  }

  const session = await getDonorPortalSession(parsed.data.slug);
  if (!session) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });
  }

  const url = await createAuthorizedBillingPortal(parsed.data.slug, session);
  if (!url) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 403 });
  }

  return NextResponse.json({ ok: true, url });
}
