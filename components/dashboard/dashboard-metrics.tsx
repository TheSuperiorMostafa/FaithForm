import { createClient } from "@/lib/supabase/server";
import { getDashboardMetrics } from "@/lib/queries/dashboard";
import { DashboardMetricsClient } from "./dashboard-metrics-client";

export async function DashboardMetricsSection({ churchId }: { churchId: string }) {
  const metrics = await getDashboardMetrics(createClient(), churchId);
  return <DashboardMetricsClient metrics={metrics} />;
}
