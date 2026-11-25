import { Suspense } from "react";

import { ChurchBillingPanel } from "@/components/admin/church-billing-panel";
import { ChurchBillingSkeleton } from "@/components/billing/billing-skeletons";
import { ErrorState } from "@/components/ui/error-state";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import {
  getAdminBillingProfile,
  getDefaultBilledTo,
  listChurchInvoices,
} from "@/lib/billing/queries";
import { currentPeriodStart, todayIsoDate } from "@/lib/billing/invoice";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The admin church page's Billing tab. Loads on its own behind a matching
 * skeleton so the rest of the church record never waits on it.
 */
export function ChurchBillingSection({ churchId, timeZone }: { churchId: string; timeZone?: string | null }) {
  return (
    <Suspense fallback={<ChurchBillingSkeleton />}>
      <ChurchBillingLoader churchId={churchId} timeZone={timeZone || "America/New_York"} />
    </Suspense>
  );
}

async function ChurchBillingLoader({ churchId, timeZone }: { churchId: string; timeZone: string }) {
  await requireSuperAdmin();
  try {
    const admin = createAdminClient();
    const [profile, invoices] = await Promise.all([
      getAdminBillingProfile(admin, churchId),
      listChurchInvoices(admin, churchId),
    ]);
    const billedTo = await getDefaultBilledTo(admin, churchId, profile);
    const now = new Date();
    return (
      <ChurchBillingPanel
        churchId={churchId}
        profile={profile}
        defaultBilledTo={billedTo}
        invoices={invoices}
        defaultPeriod={currentPeriodStart(now, timeZone).slice(0, 7)}
        defaultInvoiceDate={todayIsoDate(now, timeZone)}
      />
    );
  } catch (error) {
    console.error("[admin billing] load failed:", error);
    return (
      <ErrorState
        compact
        title="Billing didn't load"
        description="Nothing was changed. Refresh the page to try again. If this is a new environment, migration 0181 may not be applied yet."
      />
    );
  }
}
