import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function WebsiteDomainLoading() {
  return (
    <SkeletonContainer
      className="flex flex-col gap-6"
      label="domain settings"
    >
      <div className="space-y-1">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-full rounded-md" />
      </Card>

      <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      </Card>
    </SkeletonContainer>
  );
}
