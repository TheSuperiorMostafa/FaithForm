import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoadingGroups() {
  return (
    <div
      className="space-y-6 p-6"
      role="status"
      aria-busy="true"
      aria-label="Loading groups"
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-10 w-52 rounded-xl" />
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      <Card className="p-6 space-y-3 shadow-card dark:shadow-none">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <div className="flex gap-4 pt-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-4 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between">
              <Skeleton className="size-12 rounded-xl" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading groups…</span>
    </div>
  );
}
