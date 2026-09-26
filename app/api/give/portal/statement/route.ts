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
  const { data: church } = await admin
    .from("churches")
    .select("name, ein, statement_address")
    .eq("id", session.churchId)
    .single();

  const { data: donor } = await admin
    .from("giving_donors")
    .select("name, email")
    .eq("id", session.donorId)
    .eq("church_id", session.churchId)
    .single();

  const gifts = await getDonorGiftsForYear(session.churchId, session.donorId, year);

  const buffer = await renderGivingStatementPdf({
    churchName: (church?.name as string) ?? "Church",
    ein: (church?.ein as string) ?? null,
    statementAddress: (church?.statement_address as string) ?? null,
    donorName: (donor?.name as string) ?? (donor?.email as string) ?? "Donor",
    donorEmail: (donor?.email as string) ?? "",
    year,
    gifts,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="giving-statement-${year}.pdf"`,
    },
  });
}
