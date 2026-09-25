import { ROOMS_DESCRIPTION, ROOMS_TITLE } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors the Rooms page: the heading, then a two-column grid of room cards. */
export default function CheckinLocationsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="rooms">
      <SectionHeader title={ROOMS_TITLE} description={ROOMS_DESCRIPTION} />

      <div className="grid gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="flex flex-col gap-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-5 w-3/4" />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border pt-5">
              <Skeleton className="h-11 w-32 rounded-[10px]" />
              <Skeleton className="h-11 w-36 rounded-[10px]" />
              <Skeleton className="h-11 w-28 rounded-[10px]" />
            </div>
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
