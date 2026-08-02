import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendSiteContactEmail } from "@/lib/email/site-contact";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { getContactTargetBySlug } from "@/lib/sites/queries";
import { subdomainSlug } from "@/lib/sites/tenant";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * Public endpoint for the Visit-section contact form.
 *
 * Order of operations matters: the submission is written to the database
 * *before* the email is attempted. A Resend outage then costs the church a
 * notification, not the visitor.
 */

const ContactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  phone: z.string().trim().max(40).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  // Honeypot: a real visitor never sees this field, so anything in it is a bot.
  website: z.string().max(200).optional().default(""),
});

/** 5 submissions per IP per 10 minutes. Generous for a family, hostile to a script. */
const RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Which church this belongs to. The `site` query param carries it on the app
 * preview domain; on a real church hostname the subdomain is authoritative and
 * wins, so a forged param cannot redirect a submission to another church.
 */
function resolveSlug(request: NextRequest): string | null {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const fromHost = subdomainSlug(host);
  if (fromHost) return fromHost;

  const fromQuery = request.nextUrl.searchParams.get("site")?.trim();
  return fromQuery && /^[a-z0-9-]{1,63}$/i.test(fromQuery) ? fromQuery : null;
}

export async function POST(request: NextRequest) {
  const slug = resolveSlug(request);
  if (!slug) return badRequest("Could not tell which church this is for.");

  const rate = await assertRateLimit(`site-contact:${getClientIp(request)}`, RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterSeconds);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Malformed request.");
  }

  const parsed = ContactSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Please check the form.");
  }

  const { name, email, phone, message, website } = parsed.data;

  // Honeypot tripped. Answer 200 so the bot records a success and moves on
  // rather than retrying against a different field name.
  if (website.trim()) {
    console.warn(`[sites] honeypot tripped on contact form for "${slug}"`);
    return NextResponse.json({ ok: true });
  }

  const target = await getContactTargetBySlug(slug);
  if (!target) return badRequest("Could not tell which church this is for.");

  const admin = createAdminClientOrNull();
  if (!admin) {
    console.error("[sites] contact submission dropped: admin client unavailable");
    return NextResponse.json(
      { error: "We could not send that right now. Please try again shortly." },
      { status: 503 },
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("site_contact_submissions")
    .insert({
      church_id: target.churchId,
      name,
      email,
      phone: phone || null,
      message: message || null,
      source: "visit",
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    console.error("[sites] contact insert failed:", insertError.message);
    return NextResponse.json(
      { error: "We could not send that right now. Please try again shortly." },
      { status: 500 },
    );
  }

  if (!target.recipient) {
    // Stored, but nobody to notify. Surfacing this as an error would tell the
    // visitor their message vanished when it did not.
    console.warn(
      `[sites] "${slug}" has no contact recipient; submission stored only`,
    );
    return NextResponse.json({ ok: true });
  }

  const { sent } = await sendSiteContactEmail({
    churchName: target.churchName,
    recipient: target.recipient,
    name,
    email,
    phone,
    message,
    sourceUrl: request.headers.get("referer"),
  });

  if (sent && inserted?.id) {
    await admin
      .from("site_contact_submissions")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", inserted.id);
  }

  return NextResponse.json({ ok: true });
}
