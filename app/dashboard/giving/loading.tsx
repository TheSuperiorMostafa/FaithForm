import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

export default function GivingLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      label="giving"
    >
      <header className="flex flex-col gap-2">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-4 w-72 max-w-md" />
      </header>

      {/* Giving Panel */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
        <Skeleton className="h-4 w-full max-w-xl" />
      </Card>

      {/* 3 Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="space-y-2 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-3.5 w-20" />
          </Card>
        ))}
      </div>

      {/* 2 Fund Breakdown Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-4">
            <Skeleton className="h-5 w-44" />
            <SkeletonText lines={3} lastLineWidth="w-4/6" size="base" />
          </Card>
        ))}
      </div>

      {/* Giving Page Link Card */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-64" />
          </div>
          <Skeleton className="h-8 w-28 rounded-lg" />
        </CardContent>
      </Card>

      {/* Quick Nav Links */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-lg" />
        ))}
      </div>

      {/* Recent Donations Table */}
      <Card className="overflow-hidden">
        <CardHeader>
          <Skeleton className="h-5 w-36" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </SkeletonContainer>
  );
}
