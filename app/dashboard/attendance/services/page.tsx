import { redirect } from "next/navigation";

import { RetryErrorState } from "@/components/attendance/retry-error-state";
import { ServiceOccurrencesBoard } from "@/components/attendance/service-occurrences-board";
import { getServicesBoard } from "@/app/dashboard/attendance/services/actions";
import { PageHeader } from "@/components/ui/page-header";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  if (await pageFeatureBlocked("attendance")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [board, access] = await Promise.all([getServicesBoard(), getFeatureAccess()]);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={ATTENDANCE_COPY.services.title} description={ATTENDANCE_COPY.services.description} />
      {board.failed ? (
        // A board that failed to load is not "no services yet".
        <RetryErrorState
          title="Services didn't load"
          description="Nothing was lost. Try again, and if it keeps happening, contact FaithForm support."
        />
      ) : (
        <ServiceOccurrencesBoard
          upcoming={board.upcoming}
          recent={board.recent}
          other={board.other}
          counts={board.counts}
          weeklySheets={board.weeklySheets}
          isAdmin={auth.isAdmin}
          appEnabled={Boolean(access?.flags.member_app)}
        />
      )}
    </div>
  );
}
