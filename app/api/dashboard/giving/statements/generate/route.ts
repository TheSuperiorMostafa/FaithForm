import { NextResponse } from "next/server";
import { parseStatementYear } from "@/lib/giving/statement-year";
import JSZip from "jszip";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderGivingStatementPdf } from "@/lib/giving/statement-pdf";
import { getDonorGiftsForYear, getStatementDonors } from "@/lib/queries/giving";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

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

  const { searchParams } = new URL(request.url);
  // Defaults to last year until April, when year-end statements go out.
  const year = parseStatementYear(searchParams.get("year"));

  const admin = createAdminClient();
  const { data: church, error: churchError } = await admin
    .from("churches")
    .select("name, ein, statement_address")
    .eq("id", auth.churchId)
    .single();

  if (churchError) {
    console.error("[giving] statement church read failed", churchError);
    return NextResponse.json(
      { error: "We couldn't load church details. Please try again." },
      { status: 503 },
    );
  }

  if (!church?.ein) {
    return NextResponse.json(
      { error: "Add your church's tax ID (EIN) before making statements." },
      { status: 400 },
    );
  }

  let donors: Awaited<ReturnType<typeof getStatementDonors>>;
  try {
    donors = await getStatementDonors(auth.churchId, admin);
  } catch (error) {
    console.error("[giving] statement donor read failed", error);
    return NextResponse.json(
      { error: "We couldn't load donors. No statements were made." },
      { status: 503 },
    );
  }

  const zip = new JSZip();
  let statementCount = 0;

  try {
    for (const donor of donors) {
      const gifts = await getDonorGiftsForYear(auth.churchId, donor.id, year, admin);
      if (gifts.length === 0) continue;

      const buffer = await renderGivingStatementPdf({
        churchName: church.name as string,
        ein: church.ein as string,
        statementAddress: (church.statement_address as string) ?? null,
        donorName: donor.name ?? donor.email,
        donorEmail: donor.email,
        year,
        gifts,
      });

      const safeName = (donor.name ?? donor.email)
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase();

      zip.file(`statement-${year}-${safeName}.pdf`, buffer);
      statementCount += 1;
    }
  } catch (error) {
    console.error("[giving] statement generation failed", error);
    return NextResponse.json(
      { error: "We couldn't complete the statements. No file was made." },
      { status: 503 },
    );
  }

  await logAdminAction({
    churchId: auth.churchId,
    taskName: `Generated ${statementCount} giving statements for ${year}`,
    triggerSource: `admin:statements:generate:${year}`,
  });

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="giving-statements-${year}.zip"`,
    },
  });
}
