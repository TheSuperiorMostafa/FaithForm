import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function ServicesLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="events and services"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <div className="border-l-4 border-accent pl-3">
            <Skeleton className="h-8 w-52" />
          </div>
          <Skeleton className="h-4 w-80 max-w-md" />
        </div>
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-28" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="flex items-center justify-between p-4 shadow-card dark:shadow-none">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="h-3.5 w-48" />
              </div>
              <Skeleton className="h-6 w-20" />
            </Card>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Skeleton className="h-6 w-24" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="flex items-center justify-between p-4 shadow-card dark:shadow-none">
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-52" />
              </div>
              <div className="space-y-1 items-end flex flex-col">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-28" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </SkeletonContainer>
  );
}
