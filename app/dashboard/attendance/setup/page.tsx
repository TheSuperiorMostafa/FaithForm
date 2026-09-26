import { redirect } from "next/navigation";

import { CheckinSetup } from "@/components/attendance/checkin-setup";
import { RetryErrorState } from "@/components/attendance/retry-error-state";
import { getCheckinSetup } from "@/app/dashboard/attendance/setup/actions";
import { PageHeader } from "@/components/ui/page-header";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export const metadata = { title: "Attendance setup" };

export default async function CheckinSetupPage() {
  if (await pageFeatureBlocked("attendance")) return null;

  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const [result, access] = await Promise.all([getCheckinSetup(), getFeatureAccess()]);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={ATTENDANCE_COPY.setup.title} description={ATTENDANCE_COPY.setup.description} />
      {result.ok ? (
        <CheckinSetup
          view={result.data}
          isAdmin={auth.isAdmin}
          appEnabled={Boolean(access?.flags.member_app)}
        />
      ) : (
        <RetryErrorState
          title="Setup didn't load"
          description="Nothing was changed. Try again, and if it keeps happening, contact FaithForm support."
        />
      )}
    </div>
  );
}
