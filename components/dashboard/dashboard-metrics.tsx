import { createClient } from "@/lib/supabase/server";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { getDashboardMetrics } from "@/lib/queries/dashboard";
import { DashboardMetricsClient } from "./dashboard-metrics-client";

export async function DashboardMetricsSection({ churchId }: { churchId: string }) {
  const supabase = createClient();
  // The authenticated dashboard supplies the church; only aggregate call fields are read.
  const metrics = await getDashboardMetrics(supabase, churchId, createAdminClientOrNull() ?? supabase);
  return <DashboardMetricsClient metrics={metrics} />;
}
