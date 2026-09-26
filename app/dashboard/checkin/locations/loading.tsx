import { ROOMS_DESCRIPTION, ROOMS_TITLE } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors the Rooms page: the heading, then a three-column grid of short room cards. */
export default function CheckinLocationsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="rooms">
      <SectionHeader title={ROOMS_TITLE} description={ROOMS_DESCRIPTION} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-7 w-16 rounded-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
              <Skeleton className="h-11 w-32 rounded-[10px]" />
              <Skeleton className="h-11 w-36 rounded-[10px]" />
            </div>
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
