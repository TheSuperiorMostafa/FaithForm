import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function AttendanceLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-5"
      label="attendance"
    >
      <header className="flex flex-col gap-2">
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-60" />
        </div>
        <Skeleton className="h-5 w-full max-w-xl" />
      </header>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card
            key={index}
            className="flex min-h-20 flex-col justify-center gap-2 rounded-xl border border-border px-5 py-4 shadow-card dark:shadow-none"
          >
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-4 w-36" />
          </Card>
        ))}
      </div>
    </SkeletonContainer>
  );
}
