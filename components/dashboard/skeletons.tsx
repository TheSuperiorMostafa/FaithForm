import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function HeroSkeleton() {
  return (
    <Card className="overflow-hidden border-0 p-0 shadow-card">
      <div className="space-y-4 bg-gradient-to-br from-accent/15 via-card to-card p-6 md:p-8">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-14 w-48 md:h-16" />
        <Skeleton className="h-4 w-56" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-7 w-20 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-16 rounded-full" />
        </div>
      </div>
    </Card>
  );
}

export function StatRowSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="border-t-[3px] border-t-accent p-4 sm:p-5">
          <Skeleton className="mb-2 size-7 rounded-lg" />
          <Skeleton className="mb-1.5 h-3 w-20" />
          <Skeleton className="h-7 w-12" />
          <Skeleton className="mt-3 h-9 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <Card className="p-6">
      <Skeleton className="mb-2 h-5 w-40" />
      <Skeleton className="mb-6 h-4 w-64" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </Card>
  );
}
