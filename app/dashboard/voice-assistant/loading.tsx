import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function VoiceAssistantLoading() {
  return (
    <div
      className="flex flex-col gap-6 pb-28"
      role="status"
      aria-busy="true"
      aria-label="Loading voice assistant"
    >
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="border-l-4 border-accent pl-3">
            <Skeleton className="h-8 w-52" />
          </div>
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left Column: Form Cards */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Checklist Card */}
          <Card className="p-5 space-y-3 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-40" />
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-4 rounded-full" />
                  <Skeleton className="h-4 w-52" />
                </div>
              ))}
            </div>
          </Card>

          {/* Identity Section Card */}
          <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-32" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </Card>

          {/* Personality Card */}
          <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            </div>
          </Card>

          {/* Availability Card */}
          <Card className="p-6 space-y-4 shadow-card dark:shadow-none">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </Card>
        </div>

        {/* Right Column: Phone Mockup */}
        <aside className="self-start lg:sticky lg:top-6">
          <Card className="mx-auto flex h-[580px] w-full max-w-[340px] flex-col items-center justify-between rounded-[40px] border-4 border-border p-6 shadow-card dark:shadow-none">
            <div className="flex w-full items-center justify-between px-2 pt-1">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-3 w-8" />
            </div>

            <div className="flex flex-col items-center gap-4 text-center">
              <Skeleton className="size-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-36 mx-auto" />
                <Skeleton className="h-4 w-24 mx-auto" />
              </div>
              <Skeleton className="h-12 w-48 rounded-xl" />
            </div>

            <div className="flex items-center gap-6 pb-4">
              <Skeleton className="size-12 rounded-full" />
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="size-12 rounded-full" />
            </div>
          </Card>
        </aside>
      </div>
      <span className="sr-only">Loading voice assistant…</span>
    </div>
  );
}
