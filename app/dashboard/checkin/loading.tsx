import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CheckinTodayLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading check-in roster"
    >
      {/* Check someone in form card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <Skeleton className="h-10 w-28 rounded-md" />
        </CardContent>
      </Card>

      {/* Room roster columns */}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, roomIdx) => (
          <Card key={roomIdx} className="p-4 space-y-3 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, childIdx) => (
                <div key={childIdx} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <Skeleton className="h-7 w-20 rounded-md" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading check-in roster…</span>
    </div>
  );
}
