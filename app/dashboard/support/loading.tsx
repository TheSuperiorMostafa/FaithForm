import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function SupportLoading() {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-lg flex-col gap-6"
      label="support"
    >
      <div>
        <div className="border-l-4 border-accent pl-3">
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="mt-1 h-4 w-80 max-w-full" />
      </div>

      {/* New Ticket Card */}
      <Card>
        <CardHeader className="space-y-1">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-28 w-full rounded-md" />
          </div>
          <div className="flex justify-end pt-2">
            <Skeleton className="h-10 w-28 rounded-md" />
          </div>
        </CardContent>
      </Card>

      {/* Your Tickets Card */}
      <Card>
        <CardHeader className="space-y-1">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-border p-3.5">
              <div className="space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
