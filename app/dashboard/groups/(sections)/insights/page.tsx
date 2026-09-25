import { Insights } from "@/components/groups/insights";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as insights from "@/lib/groups/staff/insights";

export const dynamic = "force-dynamic";

export default async function GroupReportsPage() {
  const ctx = await requireGroupsStaff();
  const [summary, trend, health] = await Promise.all([
    insights.churchGroupSummary(ctx),
    insights.weeklyTrend(ctx, null),
    insights.groupHealth(ctx),
  ]);
  return <Insights summary={summary} trend={trend} health={health} />;
}
