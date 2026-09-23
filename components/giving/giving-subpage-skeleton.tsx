import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

type GivingSubpageSkeletonProps = {
  titleWidth?: string;
  descriptionWidth?: string;
  columns?: number;
  rows?: number;
  label: string;
};

export function GivingSubpageSkeleton({
  titleWidth = "w-32",
  descriptionWidth = "w-72",
  columns = 4,
  rows = 8,
  label,
}: GivingSubpageSkeletonProps) {
  return (
    <SkeletonContainer
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
      label={label}
    >
      <Skeleton className="h-4 w-28" />
      <div className="space-y-1">
        <Skeleton className={`h-8 ${titleWidth}`} />
        <Skeleton className={`h-4 ${descriptionWidth} max-w-full`} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border p-4">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-4 p-4"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: columns }).map((_, colIdx) => (
                <Skeleton
                  key={colIdx}
                  className={`h-4 ${colIdx === 0 ? "w-3/4" : "w-1/2"}`}
                />
              ))}
            </div>
          ))}
        </div>
      </Card>
    </SkeletonContainer>
  );
}
