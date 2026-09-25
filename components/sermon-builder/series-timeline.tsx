import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { SermonSeries, SeriesPlan } from "@/types/sermon";

export function SeriesTimeline({ series }: { series: SermonSeries }) {
  const plan = series.plan as SeriesPlan | null;

  if (!plan?.weeks?.length) {
    return (
      <EmptyState
        compact
        icon={Layers}
        title="No weeks planned yet"
        description="This series doesn't have a week-by-week plan. Start a new series to have one made for you."
      />
    );
  }

  return (
    <ol className="grid gap-4 md:grid-cols-2">
      {plan.weeks.map((week) => (
        <li key={week.week}>
          <Card className="h-full">
            <CardHeader>
              <p className="text-sm font-semibold text-muted-foreground">Week {week.week}</p>
              <CardTitle className="text-lg">{week.title}</CardTitle>
              <p className="text-[15px] text-muted-foreground">{week.scripture}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="list-disc space-y-1 pl-5 text-[15px]">
                {week.themes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <Button
                className="w-fit"
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/sermon-builder/new?series=${series.id}&topic=${encodeURIComponent(week.title)}&scripture=${encodeURIComponent(week.scripture)}`}
                  />
                }
              >
                <Plus aria-hidden className="size-5" />
                Start this week&apos;s sermon
              </Button>
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  );
}
