import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function WebsiteMessagesLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading contact messages"
    >
      <div className="space-y-1">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <Card className="divide-y divide-border overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between p-4">
            <div className="space-y-1.5 flex-1 pr-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3.5 w-40" />
              </div>
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-3.5 w-20 shrink-0" />
          </div>
        ))}
      </Card>
      <span className="sr-only">Loading contact messages…</span>
    </div>
  );
}
