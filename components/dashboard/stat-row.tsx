import {
  Phone,
  Presentation,
  Share2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatSparkline } from "@/components/dashboard/stat-sparkline";
import { createClient } from "@/lib/supabase/server";
import {
  getStatRow,
  type DashboardRange,
  type StatMetric,
} from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

type StatRowProps = {
  churchId: string;
  range: DashboardRange;
};

function DeltaBadge({
  delta,
  range,
}: {
  delta: number | null;
  range: DashboardRange;
}) {
  if (delta === null) return null;
  const up = delta >= 0;
  const period =
    range === "week" ? "week" : range === "month" ? "month" : "period";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        up
          ? "text-green-700 dark:text-green-300"
          : "text-amber-700 dark:text-amber-300",
      )}
    >
      {up ? (
        <TrendingUp className="size-3" strokeWidth={1.75} aria-hidden />
      ) : (
        <TrendingDown className="size-3" strokeWidth={1.75} aria-hidden />
      )}
      {up ? "+" : ""}
      {delta}% vs last {period}
    </span>
  );
}

function StatCard({
  label,
  metric,
  icon: Icon,
  range,
}: {
  label: string;
  metric: StatMetric;
  icon: typeof Phone;
  range: DashboardRange;
}) {
  return (
    <Card className="relative flex flex-col gap-2 overflow-hidden border-t-[3px] border-t-accent p-4 transition-shadow hover:shadow-card-hover sm:p-5">
      <div className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="pr-10">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 font-heading text-2xl font-bold tabular-nums tracking-tight text-foreground dark:text-accent sm:text-3xl">
          {metric.value}
        </p>
        <div className="mt-0.5">
          <DeltaBadge delta={metric.deltaPercent} range={range} />
        </div>
      </div>
      <StatSparkline data={metric.sparkline} className="h-9 w-full" />
    </Card>
  );
}

export async function StatRow({ churchId, range }: StatRowProps) {
  const supabase = createClient();
  const stats = await getStatRow(supabase, churchId, range);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Phone calls"
        metric={stats.phoneCalls}
        icon={Phone}
        range={range}
      />
      <StatCard
        label="SM posts"
        metric={stats.smPosts}
        icon={Share2}
        range={range}
      />
      <StatCard
        label="PowerPoints created"
        metric={stats.pptxCreated}
        icon={Presentation}
        range={range}
      />
    </div>
  );
}
