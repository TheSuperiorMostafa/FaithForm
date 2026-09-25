import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors `series/[id]/page.tsx`: title and theme (data), then the weeks. */
export default function SeriesDetailLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="series">
      <SermonBackLinkStatic label="Back to Sermons" />
      <header className="flex flex-col gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-full">
            <CardHeader>
              <p className="text-sm font-semibold text-muted-foreground">Week {i + 1}</p>
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="space-y-2 pl-5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-3/5" />
              </div>
              <Skeleton className="h-11 w-56 rounded-[10px]" />
            </CardContent>
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
