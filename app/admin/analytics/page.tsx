import {
  MonthAreaChart,
  MonthBarChart,
  NameBarChart,
} from "@/components/admin/charts";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminAnalytics } from "@/lib/queries/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminAnalyticsPage() {
  const analytics = await getAdminAnalytics();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Platform-wide growth, automation, and AI usage trends."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <ChartCard title="Churches over time">
          <MonthAreaChart
            data={analytics.churchesOverTime}
            emptyMessage="No new churches in the last 12 months."
          />
        </ChartCard>

        <ChartCard title="Platform hours saved per month">
          <MonthBarChart
            data={analytics.hoursSavedPerMonth}
            emptyMessage="No activity log time saved in the last 12 months."
          />
        </ChartCard>

        <ChartCard title="AI model usage">
          <NameBarChart
            data={analytics.aiModelUsage}
            emptyMessage="No sermon model usage recorded."
          />
        </ChartCard>

        <ChartCard title="Sermon generation by provider">
          <NameBarChart
            data={analytics.sermonGenerationByProvider}
            emptyMessage="No sermon provider usage in the last 12 months."
          />
        </ChartCard>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Automation activity by type</CardTitle>
          </CardHeader>
          <CardContent>
            <NameBarChart
              data={analytics.automationActivityByType}
              emptyMessage="No automation activity in the last 30 days."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
