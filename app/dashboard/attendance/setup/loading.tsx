import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CheckinSetupLoading() {
  return (
    <div
      className="flex w-full flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading automatic attendance setup"
    >
      <header className="flex flex-col gap-2">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-64" />
        </div>
        <Skeleton className="h-4 w-96 max-w-full" />
      </header>

      <Card className="p-5 space-y-4">
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          ))}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5 space-y-3 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-5 w-40" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-72" />
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading automatic attendance setup…</span>
    </div>
  );
}
