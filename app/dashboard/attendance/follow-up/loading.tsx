import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function AttendanceFollowUpLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="attendance follow-up"
    >
      <header className="flex flex-col gap-2">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-44" />
        </div>
        <Skeleton className="h-4 w-72" />
      </header>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-lg shrink-0" />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="flex items-center justify-between p-4 shadow-card dark:shadow-none">
            <div className="flex items-center gap-3">
              <Skeleton className="size-5 rounded" />
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            </div>
            <Skeleton className="h-6 w-36 rounded-full" />
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
