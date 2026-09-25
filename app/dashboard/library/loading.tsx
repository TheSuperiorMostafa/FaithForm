import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors Reports: the real page header and section headings, then rows of
 * monthly reports with their Download button. Only month names and figures
 * shimmer.
 */
export default function ReportsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="reports">
      <PageHeader title="Reports" description="Monthly attendance reports to download." />

      {[
        { title: "Attendance", description: "One report for each month you took attendance.", rows: 4 },
        { title: "Monthly summary", description: "What FaithForm did for your church each month.", rows: 2 },
      ].map((section) => (
        <section key={section.title} className="flex flex-col gap-4">
          <SectionHeader title={section.title} description={section.description} />
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {Array.from({ length: section.rows }).map((_, index) => (
              <li
                key={index}
                className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-4">
                  <Skeleton className="size-11 shrink-0 rounded-xl" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                </div>
                <Skeleton className="min-h-11 w-44 rounded-[10px]" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SkeletonContainer>
  );
}
