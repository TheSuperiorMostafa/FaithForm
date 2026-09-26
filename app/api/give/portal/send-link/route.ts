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
import { upsertGivingDonor } from "@/lib/giving/donors";
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

  // Anyone who has ever given here with this address can sign in — one-time
  // or recurring, web or app. The link only ever goes to the address itself.
  const donorId = await donorIdForEmail(admin, church.churchId, email);
  if (!donorId) return generic;

  try {
    const magicLink = await createPortalMagicLink({
      churchId: church.churchId,
      donorId,
      churchSlug: church.slug,
    });

    const { sent } = await sendPortalMagicLinkEmail({
      donorEmail: email,
      churchName: church.churchName,
      magicLink,
      isNewDonor: false,
      primaryColor: church.givingPrimaryColor,
      accentColor: church.givingAccentColor,
      logoUrl: church.logoUrl,
    });
    if (!sent) console.error("[portal-link] delivery unavailable");
  } catch {
    console.error("[portal-link] delivery unavailable");
  }
  return generic;
}

/**
 * The donor for this address at this church. A gift recorded with the address
 * but no donor (older gifts) still counts: the donor is created and those gifts
 * are attached to it, so the portal shows them.
 */
async function donorIdForEmail(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  email: string,
): Promise<string | null> {
  // Case-insensitive, but exact: `_` and `%` are wildcards to ilike and are
  // common in addresses, so they are escaped. A looser match could attach
  // someone else's gifts to this address.
  const exactEmail = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: existingDonor } = await admin
    .from("giving_donors")
    .select("id")
    .eq("church_id", churchId)
    .eq("email", email)
    .maybeSingle();
  if (existingDonor?.id) return existingDonor.id as string;

  const { data: gift } = await admin
    .from("giving_donations")
    .select("donor_name")
    .eq("church_id", churchId)
    .ilike("donor_email", exactEmail)
    .eq("status", "succeeded")
    .limit(1)
    .maybeSingle();
  if (!gift) return null;

  try {
    const { donorId } = await upsertGivingDonor({
      churchId,
      email,
      name: (gift.donor_name as string | null) ?? "",
    });
    await admin
      .from("giving_donations")
      .update({ donor_id: donorId })
      .eq("church_id", churchId)
      .ilike("donor_email", exactEmail)
      .is("donor_id", null);
    return donorId;
  } catch {
    console.error("[portal-link] donor setup unavailable");
    return null;
  }
}
