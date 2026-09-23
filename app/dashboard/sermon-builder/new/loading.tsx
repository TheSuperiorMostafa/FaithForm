import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function NewSermonLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      label="sermon builder"
    >
      <div className="border-l-4 border-accent pl-3">
        <Skeleton className="h-8 w-44" />
      </div>

      <Card className="p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        <div className="space-y-3">
          <Skeleton className="h-4 w-24" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <Skeleton className="h-11 w-40 rounded-lg" />
        </div>
      </Card>
    </SkeletonContainer>
  );
}
