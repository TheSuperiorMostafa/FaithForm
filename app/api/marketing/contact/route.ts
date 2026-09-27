import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { z } from "zod";

import { marketingConfig } from "@/components/marketing/config";
import { renderEmail } from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";
import { getClientIp } from "@/lib/security/rate-limit";

const ContactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  church: z.string().trim().min(1).max(120),
  message: z.string().trim().min(10).max(3000),
  website: z.string().max(200).optional().default(""),
});

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  if (attempts.size > 1000) {
    for (const [storedKey, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(storedKey);
    }
  }
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "This form must be sent from FaithForm." }, { status: 403 });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 8000) {
      return NextResponse.json({ error: "That message is too long." }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Please check the form and try again." }, { status: 400 });
  }

  const parsed = ContactSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please complete each field with a valid email and a short message." }, { status: 400 });
  }

  const { name, email, church, message, website } = parsed.data;
  if (website) return NextResponse.json({ ok: true });

  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ error: "Too many messages right now. Please email us directly." }, { status: 429 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[marketing contact] RESEND_API_KEY is not configured");
    return NextResponse.json({ error: "We couldn't send your message right now. Please email us directly." }, { status: 503 });
  }

  const content = renderEmail({
    title: "New FaithForm website enquiry",
    preheader: `${name} from ${church} asked to talk about FaithForm.`,
    heading: "A church wants to talk",
    blocks: [
      { kind: "detail", label: "Name", value: name },
      { kind: "detail", label: "Email", value: email },
      { kind: "detail", label: "Church", value: church },
      { kind: "subheading", text: "Message" },
      { kind: "quote", text: message },
      { kind: "muted", text: `Reply to this email to answer ${name} directly.` },
    ],
    footerNote: "Sent from the FaithForm.io homepage.",
    permissionNote: "You received this because you handle FaithForm enquiries.",
  });

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: `FaithForm <${resolveFromAddress()}>`,
      to: marketingConfig.contactEmail,
      replyTo: email,
      subject: "New FaithForm website enquiry",
      html: content.html,
      text: content.text,
    });
    if (error || !data?.id) {
      console.error("[marketing contact] Resend rejected the message", error);
      return NextResponse.json({ error: "We couldn't send your message right now. Please email us directly." }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[marketing contact] Email delivery failed", error);
    return NextResponse.json({ error: "We couldn't send your message right now. Please email us directly." }, { status: 503 });
  }
}
