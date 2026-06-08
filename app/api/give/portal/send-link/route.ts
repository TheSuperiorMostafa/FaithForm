import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPortalMagicLinkEmail } from "@/lib/email/giving";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { createPortalMagicLink } from "@/lib/giving/portal-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchBySlug } from "@/lib/queries/giving";

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

  const magicLink = await createPortalMagicLink({
    churchId: church.churchId,
    donorId,
    churchSlug: church.slug,
  });

  await sendPortalMagicLinkEmail({
    donorEmail: email,
    churchName: church.churchName,
    magicLink,
  });

  return NextResponse.json({
    ok: true,
    message: "If that email is valid, we sent a sign-in link.",
  });
}
