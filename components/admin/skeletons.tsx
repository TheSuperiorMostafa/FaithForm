import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminStatGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-5">
          <Skeleton className="mb-4 size-10 rounded-xl" />
          <Skeleton className="mb-2 h-4 w-28" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="mt-3 h-3 w-36" />
        </Card>
      ))}
    </div>
  );
}

export function AdminTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="overflow-hidden">
      <div className="space-y-2 border-b border-border p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-3 p-4 sm:grid-cols-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AdminChartSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-2 h-5 w-44" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </Card>
  );
}

export function AdminPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <AdminStatGridSkeleton />
      <AdminTableSkeleton />
    </div>
  );
}
