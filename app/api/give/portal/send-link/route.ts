import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPortalMagicLinkEmail } from "@/lib/email/giving";
import { upsertGivingDonor } from "@/lib/giving/donors";
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

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const email = parsed.data.email.trim().toLowerCase();

  const { data: existingDonor } = await admin
    .from("giving_donors")
    .select("id")
    .eq("church_id", church.churchId)
    .eq("email", email)
    .maybeSingle();

  const donorId = existingDonor?.id
    ? (existingDonor.id as string)
    : (
        await upsertGivingDonor({
          churchId: church.churchId,
          email,
          name: "",
        })
      ).donorId;

  const isNewDonor = !existingDonor?.id;

  const magicLink = await createPortalMagicLink({
    churchId: church.churchId,
    donorId,
    churchSlug: church.slug,
  });

  const { sent } = await sendPortalMagicLinkEmail({
    donorEmail: email,
    churchName: church.churchName,
    magicLink,
    isNewDonor,
    primaryColor: church.givingPrimaryColor,
    accentColor: church.givingAccentColor,
  });

  if (!sent) {
    return NextResponse.json(
      {
        error:
          "We couldn't send the email right now. Please try again in a few minutes.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    message: isNewDonor
      ? "Check your email for a link to create your donor account."
      : "Check your email for a sign-in link.",
  });
}
