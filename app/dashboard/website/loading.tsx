import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function WebsiteOverviewLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading website overview"
    >
      {/* Publish Card */}
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-lg" />
            <Skeleton className="h-9 w-28 rounded-lg" />
          </div>
        </div>
      </Card>

      {/* 3 Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </Card>
        ))}
      </div>

      {/* Site Preview Frame */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="size-3 rounded-full" />
          </div>
          <Skeleton className="h-6 w-64 rounded-md" />
          <Skeleton className="size-6 rounded-md" />
        </div>
        <CardContent className="flex h-96 items-center justify-center p-6">
          <div className="space-y-4 text-center max-w-sm w-full">
            <Skeleton className="h-6 w-3/4 mx-auto" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3 mx-auto" />
          </div>
        </CardContent>
      </Card>

      {/* Web address card */}
      <Card className="p-5 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-10 w-full rounded-md" />
      </Card>
      <span className="sr-only">Loading website overview…</span>
    </div>
  );
}
