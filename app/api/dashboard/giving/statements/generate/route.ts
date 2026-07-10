import { NextResponse } from "next/server";
import JSZip from "jszip";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderGivingStatementPdf } from "@/lib/giving/statement-pdf";
import { getDonorGiftsForYear } from "@/lib/queries/giving";

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

  const { searchParams } = new URL(request.url);
  const year =
    Number.parseInt(searchParams.get("year") ?? String(new Date().getFullYear()), 10);

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("name, ein, statement_address")
    .eq("id", auth.churchId)
    .single();

  if (!church?.ein) {
    return NextResponse.json(
      { error: "Add your church EIN in Settings before generating statements." },
      { status: 400 },
    );
  }

  const { data: donors } = await admin
    .from("giving_donors")
    .select("id, name, email")
    .eq("church_id", auth.churchId);

  const zip = new JSZip();
  let statementCount = 0;

  for (const donor of donors ?? []) {
    const gifts = await getDonorGiftsForYear(
      auth.churchId,
      donor.id as string,
      year,
    );
    if (gifts.length === 0) continue;

    const buffer = await renderGivingStatementPdf({
      churchName: church.name as string,
      ein: church.ein as string,
      statementAddress: (church.statement_address as string) ?? null,
      donorName: (donor.name as string) ?? (donor.email as string),
      donorEmail: donor.email as string,
      year,
      gifts,
    });

    const safeName = ((donor.name as string) ?? donor.email as string)
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();

    zip.file(`statement-${year}-${safeName}.pdf`, buffer);
    statementCount += 1;
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
