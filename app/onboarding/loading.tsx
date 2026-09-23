import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLoading() {
  return (
    <div
      className="mx-auto flex min-h-[80vh] w-full max-w-xl flex-col items-center justify-center p-4"
      role="status"
      aria-busy="true"
      aria-label="Loading onboarding"
    >
      <Card className="w-full p-8 shadow-card dark:shadow-none space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>

        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-2 flex-1 rounded-full" />
          ))}
        </div>

        <div className="space-y-4 pt-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>

        <div className="space-y-3 pt-4">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>

        <div className="flex justify-between pt-6">
          <Skeleton className="h-10 w-24 rounded-lg" />
          <Skeleton className="h-10 w-28 rounded-lg" />
        </div>
      </Card>
      <span className="sr-only">Loading onboarding…</span>
    </div>
  );
}
