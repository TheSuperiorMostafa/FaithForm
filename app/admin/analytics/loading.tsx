import { AdminChartSkeleton } from "@/components/admin/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <AdminChartSkeleton key={i} />
      ))}
    </div>
  );
}
