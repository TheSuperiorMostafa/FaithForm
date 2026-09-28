import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { groupSeriesSermons } from "@/lib/sermon-builder/series-weeks";
import type { SeriesSermonItem } from "@/lib/queries/sermons";
import type { SermonSeries, SeriesPlan } from "@/types/sermon";

export function SeriesTimeline({
  series,
  sermons,
}: {
  series: SermonSeries;
  /** Null while the church-scoped sermon list is loading. */
  sermons: SeriesSermonItem[] | null;
}) {
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

  const grouped = sermons === null ? null : groupSeriesSermons(plan.weeks, sermons);
  const cards = (
    <ol className="grid gap-4 md:grid-cols-2">
      {plan.weeks.map((week) => {
        const saved = grouped?.byWeek.get(week.week) ?? [];
        return (
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
                <div className="flex min-h-[88px] flex-col gap-2">
                  {sermons === null ? (
                    <>
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="h-11 w-56 rounded-[10px]" />
                    </>
                  ) : saved.length > 0 ? (
                    <>
                      <p className="text-sm font-medium text-muted-foreground">
                        {saved.length === 1 ? "Sermon saved for this week" : `${saved.length} sermons saved for this week`}
                      </p>
                      {saved.map((sermon) => (
                        <Button
                          key={sermon.id}
                          className="h-auto max-w-full whitespace-normal text-left break-words"
                          variant="outline"
                          nativeButton={false}
                          render={<Link href={`/dashboard/sermon-builder/${sermon.id}`} />}
                        >
                          Open {sermon.title}
                        </Button>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">No sermon saved for this week yet.</p>
                      <Button
                        className="w-fit"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/dashboard/sermon-builder/new?series=${series.id}&week=${week.week}&topic=${encodeURIComponent(week.title)}&scripture=${encodeURIComponent(week.scripture)}`}
                          />
                        }
                      >
                        <Plus aria-hidden className="size-5" />
                        Start this week&apos;s sermon
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );

  if (sermons === null) {
    return <SkeletonContainer label="Sermon series">{cards}</SkeletonContainer>;
  }
  return (
    <div className="flex flex-col gap-6">
      {cards}
      {grouped && grouped.other.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Other sermons in this series</h2>
          <p className="text-sm text-muted-foreground">These sermons are linked to the series but not to one planned week.</p>
          <ul className="flex flex-wrap gap-2">
            {grouped.other.map((sermon) => (
              <li key={sermon.id}>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={`/dashboard/sermon-builder/${sermon.id}`} />}
                >
                  Open {sermon.title}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
