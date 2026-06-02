import Link from "next/link";
import { formatDistanceToNow } from "@/lib/format-date";
import { Card, CardContent } from "@/components/ui/card";
import type { SermonSeries } from "@/types/sermon";

export function SeriesList({ series }: { series: SermonSeries[] }) {
  if (series.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
        No series yet. Plan a multi-week series to organize your preaching calendar.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {series.map((s) => (
        <li key={s.id}>
          <Link href={`/dashboard/sermon-builder/series/${s.id}`}>
            <Card className="transition-all hover:border-accent/50 hover:shadow-card-hover">
              <CardContent className="p-5">
                <p className="font-heading text-lg font-semibold">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.theme}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.weeks_planned} weeks · updated{" "}
                  {formatDistanceToNow(s.updated_at)}
                </p>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
