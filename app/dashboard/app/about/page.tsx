import { redirect } from "next/navigation";

import { ChurchAboutForm } from "@/components/member-app/church-about-form";
import { ErrorState } from "@/components/ui/error-state";
import { SectionHeader } from "@/components/ui/page-header";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchAppInfo } from "@/lib/queries/church-app-info";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

/**
 * Church App → About: Church description and mission
 */
export default async function ChurchAppAboutPage() {
  if (await pageFeatureBlocked("member_app")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  if (!auth.churchId) {
    return (
      <ErrorState
        title="Your account isn't connected to a church yet"
        description="Ask your church admin for an invite."
      />
    );
  }

  const churchInfo = await getChurchAppInfo(auth.churchId).catch(() => null);

  if (!churchInfo) {
    return (
      <ErrorState
        title="We couldn't load your church information"
        description="Nothing was changed. Refresh the page to try again."
        compact
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <SectionHeader
        title="About"
        description="Tell people what your church is about and what you believe."
      />
      
      <div className="rounded-xl border border-border bg-card p-6">
        <ChurchAboutForm
          initialAbout={churchInfo.info.about}
          canEdit={auth.isAdmin}
        />
      </div>
    </div>
  );
}
