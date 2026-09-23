import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function SermonDetailLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      label="sermon"
    >
      <Skeleton className="h-4 w-36" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </div>

      <Card className="aspect-video w-full rounded-2xl flex items-center justify-center p-8">
        <div className="space-y-4 text-center max-w-md w-full">
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-1/2 mx-auto" />
        </div>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="aspect-video p-2 rounded-lg space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-2/3" />
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
