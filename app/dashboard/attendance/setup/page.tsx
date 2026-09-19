import { redirect } from "next/navigation";

import { CheckinSetup } from "@/components/attendance/checkin-setup";
import { getCheckinSetup } from "@/app/dashboard/attendance/setup/actions";
import { Card, CardContent } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";

export const dynamic = "force-dynamic";

export const metadata = { title: "Automatic Attendance" };

export default async function CheckinSetupPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const result = await getCheckinSetup();

  if (!result.ok) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Automatic Attendance couldn&rsquo;t be loaded. Refresh the page to try again.
        </CardContent>
      </Card>
    );
  }

  return <CheckinSetup view={result.data} isAdmin={auth.isAdmin} />;
}
