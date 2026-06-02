import { NextResponse } from "next/server";
import { z } from "zod";
import { sendPortalMagicLinkEmail } from "@/lib/email/giving";
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

  const { data: donor } = await admin
    .from("giving_donors")
    .select("id")
    .eq("church_id", church.churchId)
    .eq("email", email)
    .maybeSingle();

  if (!donor?.id) {
    return NextResponse.json({
      ok: true,
      message: "If we find gifts for that email, we sent a sign-in link.",
    });
  }

  const magicLink = await createPortalMagicLink({
    churchId: church.churchId,
    donorId: donor.id as string,
    churchSlug: church.slug,
  });

  await sendPortalMagicLinkEmail({
    donorEmail: email,
    churchName: church.churchName,
    magicLink,
  });

  return NextResponse.json({
    ok: true,
    message: "If we find gifts for that email, we sent a sign-in link.",
  });
}
