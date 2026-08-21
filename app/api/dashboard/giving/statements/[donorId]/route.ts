import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchAuth } from "@/lib/auth/church";
import { renderGivingStatementPdf } from "@/lib/giving/statement-pdf";
import { getDonorGiftsForYear } from "@/lib/queries/giving";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ donorId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { donorId } = await context.params;
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await featureAccessDenied("giving");
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const year =
    Number.parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("name, ein, statement_address")
    .eq("id", auth.churchId)
    .single();

  const { data: donor } = await admin
    .from("giving_donors")
    .select("name, email")
    .eq("id", donorId)
    .eq("church_id", auth.churchId)
    .maybeSingle();

  if (!donor) {
    return NextResponse.json({ error: "Donor not found" }, { status: 404 });
  }

  const gifts = await getDonorGiftsForYear(auth.churchId, donorId, year);

  const buffer = await renderGivingStatementPdf({
    churchName: (church?.name as string) ?? "Church",
    ein: (church?.ein as string) ?? null,
    statementAddress: (church?.statement_address as string) ?? null,
    donorName: (donor.name as string) ?? (donor.email as string),
    donorEmail: donor.email as string,
    year,
    gifts,
  });

  const safeName = ((donor.name as string) ?? "donor")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="statement-${year}-${safeName}.pdf"`,
    },
  });
}
