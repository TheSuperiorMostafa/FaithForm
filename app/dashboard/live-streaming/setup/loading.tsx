import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function StreamSetupLoading() {
  return (
    <div
      className="grid gap-6 lg:grid-cols-2"
      role="status"
      aria-busy="true"
      aria-label="Loading stream setup"
    >
      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6 space-y-4 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full rounded-md" />
          </Card>
        ))}
      </div>
      <div className="flex flex-col gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6 space-y-4 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-10 w-full rounded-md" />
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading stream setup…</span>
    </div>
  );
}
