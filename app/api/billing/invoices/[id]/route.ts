import { NextResponse } from "next/server";

import { canViewChurchBilling, type InvoiceViewer } from "@/lib/billing/access";
import { invoiceFileName } from "@/lib/billing/invoice";
import { renderInvoicePdf } from "@/lib/billing/pdf";
import { getChurchInvoiceById } from "@/lib/billing/queries";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUserId } from "@/lib/auth/superadmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One invoice as a PDF. `?download=1` saves it; otherwise it opens in the
 * browser. Only an admin of the invoice's church, or a FaithForm platform
 * admin, gets it; everyone else gets the same "not found" so an id reveals
 * nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!UUID.test(id)) return notFound();

  const supabase = createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const invoice = await getChurchInvoiceById(admin, id);
    if (!invoice) return notFound();

    const auth = await getChurchAuth();
    const sameChurchAdmin = Boolean(auth && auth.churchId === invoice.churchId && auth.isAdmin);
    const viewer: InvoiceViewer = {
      // Only asked when church membership does not already answer it.
      isPlatformAdmin: sameChurchAdmin ? false : await isPlatformAdminUserId(userId),
      churchId: auth?.churchId ?? null,
      isChurchAdmin: Boolean(auth?.isAdmin),
    };
    if (!canViewChurchBilling(viewer, invoice.churchId)) return notFound();

    const pdf = await renderInvoicePdf(invoice);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = invoiceFileName(invoice);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[billing] invoice pdf failed:", error);
    return NextResponse.json({ error: "We couldn't make this invoice. Please try again." }, { status: 500 });
  }
}
