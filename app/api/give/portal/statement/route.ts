import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDonorPortalSession } from "@/lib/giving/portal-session";
import { renderGivingStatementPdf } from "@/lib/giving/statement-pdf";
import { getDonorGiftsForYear } from "@/lib/queries/giving";
import { parseStatementYear } from "@/lib/giving/statement-year";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  // An unreadable `year` was NaN, and NaN threw inside the date maths: a 500
  // for a donor who edited the address. Absent still means this year.
  const rawYear = searchParams.get("year");
  const year = rawYear ? parseStatementYear(rawYear) : new Date().getFullYear();

  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const session = await getDonorPortalSession(slug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: church, error: churchError } = await admin
    .from("churches")
    .select("name, ein, statement_address")
    .eq("id", session.churchId)
    .single();

  const { data: donor, error: donorError } = await admin
    .from("giving_donors")
    .select("name, email")
    .eq("id", session.donorId)
    .eq("church_id", session.churchId)
    .single();

  if (churchError || donorError || !church || !donor) {
    console.error("[giving] portal statement details unavailable", churchError, donorError);
    return NextResponse.json({ error: "We couldn't load your statement details. Please try again." }, { status: 503 });
  }

  let buffer: Buffer;
  try {
    const gifts = await getDonorGiftsForYear(session.churchId, session.donorId, year, admin);
    buffer = await renderGivingStatementPdf({
      churchName: church.name as string,
      ein: (church.ein as string) ?? null,
      statementAddress: (church.statement_address as string) ?? null,
      donorName: (donor.name as string) ?? (donor.email as string),
      donorEmail: donor.email as string,
      year,
      gifts,
    });
  } catch (error) {
    console.error("[giving] portal statement generation failed", error);
    return NextResponse.json({ error: "We couldn't make your statement. Please try again." }, { status: 503 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="giving-statement-${year}.pdf"`,
    },
  });
}
