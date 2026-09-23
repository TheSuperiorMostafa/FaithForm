import { AdminChartSkeleton } from "@/components/admin/skeletons";
import { SkeletonContainer } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <SkeletonContainer
      className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-2"
      label="analytics"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <AdminChartSkeleton key={i} />
      ))}
    </SkeletonContainer>
  );
}
