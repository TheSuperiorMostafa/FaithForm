import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function AttendanceDateLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-6"
      label="service record"
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-28" />
      </div>

      <header className="flex flex-col gap-2">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-4 w-48" />
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card className="p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-12" />
        </Card>
        <Card className="p-4 space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-12" />
        </Card>
        <Card className="col-span-2 sm:col-span-1 p-4 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-12" />
        </Card>
      </div>

      <Card className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </SkeletonContainer>
  );
}
