import { AdminTableSkeleton } from "@/components/admin/skeletons";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function AdminDomainsLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
      label="domain requests"
    >
      <div className="space-y-1">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>

      <AdminTableSkeleton rows={8} />
    </SkeletonContainer>
  );
}
