import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function PeopleLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="people directory"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="hidden h-12 w-32 rounded-lg sm:block" />
      </div>

      <Card className="p-3.5 flex items-center justify-center shadow-card dark:shadow-none">
        <Skeleton className="h-5 w-72" />
      </Card>

      <Skeleton className="h-12 w-full rounded-[10px]" />

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-16 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>

      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="flex items-center justify-between p-3.5 shadow-card dark:shadow-none">
            <div className="flex items-center gap-3.5">
              <Skeleton className="size-11 rounded-full shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-4 w-8" />
            </div>
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
