import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

export default function WebsiteSermonsLoading() {
  return (
    <SkeletonContainer
      className="flex flex-col gap-6"
      label="website sermons"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border p-4">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-12 w-20 rounded-md" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </SkeletonContainer>
  );
}
