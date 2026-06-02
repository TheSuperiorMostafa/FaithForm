import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SermonSeries, SeriesPlan } from "@/types/sermon";

export function SeriesTimeline({ series }: { series: SermonSeries }) {
  const plan = series.plan as SeriesPlan | null;

  if (!plan?.weeks?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No plan generated yet.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {plan.weeks.map((week) => (
        <Card key={week.week}>
          <CardHeader>
            <CardTitle className="text-base">
              Week {week.week}: {week.title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{week.scripture}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc pl-5 text-sm">
              {week.themes.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <Button
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={`/dashboard/sermon-builder/new?series=${series.id}&topic=${encodeURIComponent(week.title)}&scripture=${encodeURIComponent(week.scripture)}`}
                />
              }
            >
              Generate sermon for this week
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
