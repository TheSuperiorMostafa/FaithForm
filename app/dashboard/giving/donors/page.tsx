import { redirect } from "next/navigation";

import { DownloadSpreadsheetButton } from "@/components/ui/download-spreadsheet-button";
import { DonorsList } from "@/components/giving/donors-list";
import { GivingNotReady, GivingSubpageHeader } from "@/components/giving/giving-page-parts";
import { ErrorState } from "@/components/ui/error-state";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchGivingProfile, getDonorsList } from "@/lib/queries/giving";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function DonorsPage() {
  if (await pageFeatureBlocked("giving")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.stripeChargesEnabled) {
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="donors" />
        <GivingNotReady isAdmin={auth.isAdmin} />
      </div>
    );
  }

  let donors;
  try {
    donors = await getDonorsList(auth.churchId);
  } catch (error) {
    console.error("[giving] donors failed to load", error);
    return (
      <div className="flex w-full flex-col gap-8">
        <GivingSubpageHeader page="donors" />
        <ErrorState
          title="Donors didn't load"
          description="Nothing was lost. Refresh the page to try again, and if it keeps happening, contact FaithForm support."
        />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <GivingSubpageHeader
        page="donors"
        secondary={auth.isAdmin && donors.length > 0 ? <DownloadSpreadsheetButton href="/api/dashboard/giving/export/donors" what="donors" /> : null}
      />
      <DonorsList donors={donors} />
    </div>
  );
}
