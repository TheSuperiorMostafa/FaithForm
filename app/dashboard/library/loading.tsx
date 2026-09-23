import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LibraryLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-8"
      role="status"
      aria-busy="true"
      aria-label="Loading library"
    >
      <header>
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-36" />
        </div>
        <Skeleton className="mt-1.5 h-4 w-72" />
      </header>

      {/* Attendance Reports */}
      <section className="flex flex-col gap-4">
        <Skeleton className="h-6 w-48" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card
              key={i}
              className="flex flex-col gap-4 rounded-xl border border-border p-5 shadow-card dark:shadow-none md:flex-row md:items-center md:justify-between md:p-6"
            >
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-9 w-32 rounded-md shrink-0" />
            </Card>
          ))}
        </div>
      </section>

      {/* Monthly Reports */}
      <section className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card
              key={i}
              className="flex flex-col gap-4 rounded-xl border border-border p-5 shadow-card dark:shadow-none md:flex-row md:items-center md:justify-between md:p-6"
            >
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-9 w-32 rounded-md shrink-0" />
            </Card>
          ))}
        </div>
      </section>

      {/* Support */}
      <section className="flex flex-col gap-4">
        <Skeleton className="h-6 w-28" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="flex items-center gap-4 p-5 shadow-card dark:shadow-none">
              <Skeleton className="size-10 rounded-xl shrink-0" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </Card>
          ))}
        </div>
      </section>
      <span className="sr-only">Loading library…</span>
    </div>
  );
}
