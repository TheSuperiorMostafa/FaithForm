import { SermonBackLinkStatic } from "@/components/sermon-builder/sermon-back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { NEW_SERIES_DESCRIPTION, NEW_SERIES_TITLE } from "@/lib/sermon-builder/page-copy";

const FIELDS = [
  "Series title",
  "What the series is about",
  "Main Bible passage (optional)",
  "How many weeks",
];

export default function NewSeriesLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="series form">
      <SermonBackLinkStatic label="Back to Sermons" />
      <PageHeader title={NEW_SERIES_TITLE} description={NEW_SERIES_DESCRIPTION} />
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>Plan a sermon series</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {FIELDS.map((label) => (
              <div key={label} className="space-y-2">
                <p className="text-[15px] font-medium leading-none">{label}</p>
                <Skeleton className="h-11 w-full rounded-[10px]" />
              </div>
            ))}
            <div className="space-y-2">
              <p className="text-[15px] font-medium leading-none">Description (optional)</p>
              <Skeleton className="h-24 w-full rounded-[10px]" />
            </div>
            <Skeleton className="h-12 w-44 rounded-[10px]" />
          </div>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
