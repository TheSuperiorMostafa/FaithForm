import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-6xl flex-col gap-5"
      role="status"
      aria-busy="true"
      aria-label="Loading settings"
    >
      <div>
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-36" />
        </div>
        <Skeleton className="mt-1 h-4 w-96 max-w-full" />
      </div>

      {/* Church Branding Images Card */}
      <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
        <Skeleton className="h-5 w-44" />
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="size-24 rounded-2xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </Card>

      {/* Settings Tabs Strip */}
      <div className="flex gap-2 overflow-x-auto border-b border-border pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-lg shrink-0" />
        ))}
      </div>

      {/* Settings Tab Content Card */}
      <Card className="p-6 space-y-6 shadow-card dark:shadow-none">
        <div className="space-y-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </div>
      </Card>
      <span className="sr-only">Loading settings…</span>
    </div>
  );
}
