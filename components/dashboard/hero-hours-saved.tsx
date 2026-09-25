import { Suspense } from "react";
import { Clock, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { RangePicker } from "@/components/dashboard/range-picker";
import { createClient } from "@/lib/supabase/server";
import {
  getHoursSavedBreakdown,
  type DashboardRange,
} from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

type HeroHoursSavedProps = {
  churchId: string;
  range: DashboardRange;
};

function formatDelta(delta: number | null, range: DashboardRange) {
  if (delta === null) return null;
  const period =
    range === "week" ? "last week" : range === "month" ? "last month" : "before";
  const up = delta >= 0;
  return { up, text: `${up ? "Up" : "Down"} ${Math.abs(delta)}% from ${period}` };
}

/**
 * The time FaithForm saved the church, said honestly: it is an estimate built
 * from how long each job usually takes by hand.
 */
export async function HeroHoursSaved({ churchId, range }: HeroHoursSavedProps) {
  const supabase = createClient();
  const data = await getHoursSavedBreakdown(supabase, churchId, range);
  const delta = formatDelta(data.deltaPercent, range);
  const empty = data.taskCount === 0;

  return (
    <Card className="flex h-full flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-primary dark:text-accent"
        >
          <Clock className="size-6" strokeWidth={1.75} />
        </span>
        <h3 className="font-heading text-lg font-bold text-foreground">Time FaithForm saved you</h3>
      </div>

      {empty ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          When FaithForm does work for you, like posting announcements,
          answering calls and building slides, the time you save shows up here.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="font-heading text-5xl font-bold tabular-nums tracking-tight text-foreground">
            {data.totalHours}
            <span className="ml-2 font-sans text-2xl font-semibold text-muted-foreground">
              {data.totalHours === 1 ? "hour" : "hours"}
            </span>
          </p>
          <p className="text-[15px] text-muted-foreground">
            Estimated from {data.taskCount} {data.taskCount === 1 ? "job" : "jobs"} FaithForm
            did for you.
          </p>
          {delta && (
            <p
              className={cn(
                "inline-flex items-center gap-1.5 text-[15px] font-semibold",
                delta.up ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
              )}
            >
              {delta.up ? (
                <TrendingUp className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <TrendingDown className="size-4" strokeWidth={1.75} aria-hidden />
              )}
              {delta.text}
            </p>
          )}
        </div>
      )}

      <div className="mt-auto">
        <Suspense fallback={null}>
          <RangePicker value={range} />
        </Suspense>
      </div>
    </Card>
  );
}
