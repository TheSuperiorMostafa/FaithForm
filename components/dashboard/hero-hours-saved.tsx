import { Suspense } from "react";
import { Clock, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RangePicker } from "@/components/dashboard/range-picker";
import { createClient } from "@/lib/supabase/server";
import {
  getHoursSavedBreakdown,
  type DashboardRange,
} from "@/lib/queries/dashboard";
import type { AutomationCategory } from "@/lib/automation-catalog";
import { cn } from "@/lib/utils";

type HeroHoursSavedProps = {
  churchId: string;
  range: DashboardRange;
};

const categoryLabels: { key: AutomationCategory; short: string }[] = [
  { key: "Calendar", short: "Calendar" },
  { key: "Communication", short: "Comms" },
  { key: "Phone", short: "Phone" },
  { key: "Social", short: "Social" },
  { key: "Admin", short: "Admin" },
];

function formatDelta(delta: number | null, range: DashboardRange) {
  if (delta === null) return null;
  const period =
    range === "week" ? "last week" : range === "month" ? "last month" : "";
  const up = delta >= 0;
  return { up, text: `${up ? "+" : ""}${delta}% vs ${period}`.trim() };
}

export async function HeroHoursSaved({ churchId, range }: HeroHoursSavedProps) {
  const supabase = createClient();
  const data = await getHoursSavedBreakdown(supabase, churchId, range);
  const delta = formatDelta(data.deltaPercent, range);

  const activeCategories = categoryLabels.filter(
    ({ key }) => data.byCategory[key] > 0,
  );

  return (
    <Card className="overflow-hidden border-0 shadow-card">
      <div className="relative bg-gradient-to-br from-accent/15 via-card to-card p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Clock className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
            <span>Hours saved</span>
          </div>
          <Suspense fallback={null}>
            <RangePicker value={range} />
          </Suspense>
        </div>

        <p className="mt-4 font-heading text-5xl font-bold tabular-nums tracking-tight text-foreground md:text-6xl">
          {data.totalHours}
          <span className="ml-2 font-sans text-2xl font-semibold text-muted-foreground md:text-3xl">
            hrs
          </span>
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            {data.taskCount} task{data.taskCount === 1 ? "" : "s"} automated
          </span>
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-1 font-medium",
                delta.up ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300",
              )}
            >
              {delta.up ? (
                <TrendingUp className="size-3.5" strokeWidth={1.75} aria-hidden />
              ) : (
                <TrendingDown className="size-3.5" strokeWidth={1.75} aria-hidden />
              )}
              {delta.text}
            </span>
          )}
        </div>

        {activeCategories.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {activeCategories.map(({ key, short }) => {
              const mins = data.byCategory[key];
              const hrs = Math.round((mins / 60) * 10) / 10;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-background/70 px-3 py-1 text-[13px] font-semibold text-foreground backdrop-blur-sm"
                >
                  <span className="text-muted-foreground">{short}</span>
                  <span className="tabular-nums">{hrs}h</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
