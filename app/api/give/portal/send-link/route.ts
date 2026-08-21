import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPortalMagicLinkEmail } from "@/lib/email/giving";
import { createPortalMagicLink } from "@/lib/giving/portal-session";
import { getChurchBySlug } from "@/lib/queries/giving";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
});

export async function POST(request: Request) {
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
  const rate = await assertRateLimit(`portal-link:${ip}:${parsed.data.slug}`, {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.ok) {
    return rateLimitResponse(rate.retryAfterSeconds);
  }

  const generic = NextResponse.json({
    ok: true,
    message: "If that donor account exists, a sign-in link will arrive shortly.",
  });

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church) return generic;

  const admin = createAdminClient();
  const email = parsed.data.email.trim().toLowerCase();

  const { data: existingDonor } = await admin
    .from("giving_donors")
    .select("id")
    .eq("church_id", church.churchId)
    .eq("email", email)
    .maybeSingle();

  if (!existingDonor?.id) return generic;

  try {
    const magicLink = await createPortalMagicLink({
      churchId: church.churchId,
      donorId: existingDonor.id as string,
      churchSlug: church.slug,
    });

    const { sent } = await sendPortalMagicLinkEmail({
      donorEmail: email,
      churchName: church.churchName,
      magicLink,
      isNewDonor: false,
      primaryColor: church.givingPrimaryColor,
      accentColor: church.givingAccentColor,
    });
    if (!sent) console.error("[portal-link] delivery unavailable");
  } catch {
    console.error("[portal-link] delivery unavailable");
  }
  return generic;
}
