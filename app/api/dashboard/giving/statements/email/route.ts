import { NextResponse } from "next/server";
import { z } from "zod";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { isChurchFeatureEmailEnabled } from "@/lib/features/access";
import { featureAccessDenied } from "@/lib/features/guard";
import { renderGivingStatementPdf } from "@/lib/giving/statement-pdf";
import { isStatementEmailConfigured, sendStatementEmail } from "@/lib/giving/statement-email";
import { parseStatementYear } from "@/lib/giving/statement-year";
import { getDonorGiftsForYear } from "@/lib/queries/giving";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * Emails year-end statements to a small batch of donors (at most 10 per
 * request). The page sends the whole list in batches so a church with
 * hundreds of donors never hits a request time limit, and shows who got one.
 *
 * Every donor id is re-checked against the caller's church; an id from
 * another church is reported as "skipped" and never read.
 */
const MAX_BATCH = 10;
/** The email provider allows a few requests a second; stay under it. */
const SEND_SPACING_MS = 600;

const bodySchema = z.object({
  year: z.union([z.number().int(), z.string()]),
  donorIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH),
  runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
});

type DonorResult = { donorId: string; status: "sent" | "failed" | "skipped" };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
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
      { error: "We couldn't tell who to email. Refresh the page and try again." },
      { status: 400 },
    );
  }

  if (!isStatementEmailConfigured()) {
    return NextResponse.json(
      { error: "Email isn't available right now. Download the statements to print or send them yourself." },
      { status: 503 },
    );
  }
  // A platform admin can switch Giving's emails off for a church.
  if (!(await isChurchFeatureEmailEnabled(auth.churchId, "giving"))) {
    return NextResponse.json(
      { error: "Giving emails are switched off for your church. Download the statements to print or send them yourself." },
      { status: 403 },
    );
  }

  const year = parseStatementYear(String(parsed.data.year));
  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("name, slug, ein, statement_address, logo_url, giving_primary_color, giving_accent_color")
    .eq("id", auth.churchId)
    .single();

  if (!church?.ein) {
    return NextResponse.json(
      { error: "Add your church's tax ID (EIN) before sending statements." },
      { status: 400 },
    );
  }

  const { data: donors, error: donorsError } = await admin
    .from("giving_donors")
    .select("id, name, email")
    .eq("church_id", auth.churchId)
    .in("id", parsed.data.donorIds);
  if (donorsError) {
    console.error("[giving] statement email donor read failed", donorsError);
    return NextResponse.json(
      { error: "We couldn't load these donors. Nothing was sent. Please try again." },
      { status: 500 },
    );
  }

  const byId = new Map((donors ?? []).map((d) => [d.id as string, d]));
  const results: DonorResult[] = [];
  let sentAny = false;

  for (const donorId of parsed.data.donorIds) {
    const donor = byId.get(donorId);
    const email = (donor?.email as string | undefined)?.trim();
    if (!donor || !email) {
      results.push({ donorId, status: "skipped" });
      continue;
    }
    try {
      const gifts = await getDonorGiftsForYear(auth.churchId, donorId, year);
      if (gifts.length === 0) {
        results.push({ donorId, status: "skipped" });
        continue;
      }
      const donorName = (donor.name as string | null) ?? null;
      const pdf = await renderGivingStatementPdf({
        churchName: church.name as string,
        ein: church.ein as string,
        statementAddress: (church.statement_address as string | null) ?? null,
        donorName: donorName ?? email,
        donorEmail: email,
        year,
        gifts,
      });

      if (sentAny) await sleep(SEND_SPACING_MS);
      const input = {
        donorEmail: email,
        donorName,
        churchName: church.name as string,
        churchSlug: (church.slug as string | null) ?? null,
        primaryColor: (church.giving_primary_color as string | null) ?? null,
        accentColor: (church.giving_accent_color as string | null) ?? null,
        logoUrl: (church.logo_url as string | null) ?? null,
        year,
        totalCents: gifts.reduce((sum, g) => sum + g.amountCents, 0),
        giftCount: gifts.length,
        pdf,
        idempotencyKey: `giving-statement/${auth.churchId}/${year}/${donorId}/${parsed.data.runId}`,
      };
      let result = await sendStatementEmail(input);
      if (!result.sent && result.rateLimited) {
        await sleep(2000);
        result = await sendStatementEmail(input);
      }
      sentAny = true;
      results.push({ donorId, status: result.sent ? "sent" : "failed" });
    } catch (error) {
      console.error("[giving] statement email failed", donorId, error);
      results.push({ donorId, status: "failed" });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  await logAdminAction({
    churchId: auth.churchId,
    taskName: `Emailed ${sent} of ${results.length} giving statements for ${year}`,
    triggerSource: `admin:statements:email:${year}`,
  });

  return NextResponse.json({ year, results });
}
