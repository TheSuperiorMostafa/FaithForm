import { ArrowLeft, CalendarDays, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Mirrors `page.tsx`: back link, header with New plan, four tabs, plan rows. */
export default function ServiceTypeLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="plans">
      <div className="flex flex-col gap-4">
        <span aria-hidden className={cn(buttonVariants({ variant: "link" }), "w-fit")}>
          <ArrowLeft className="size-4" />
          Service Plans
        </span>
        <PageHeader
          title={<Skeleton className="h-9 w-56" />}
          description="Each date's plan, the templates new plans start from, who serves, and default times."
          icon={CalendarDays}
          action={
            <span aria-hidden className={buttonVariants({ size: "lg" })}>
              <Plus className="size-5" />
              New plan
            </span>
          }
        />
      </div>
      <div>
        <div className="inline-flex min-h-11 max-w-full items-center gap-1 overflow-x-auto border-b border-border text-muted-foreground">
          {["Plans", "Templates", "Teams and positions", "Settings"].map((label, i) => (
            <span
              key={label}
              className={cn(
                "inline-flex min-h-11 items-center whitespace-nowrap px-4 py-2 text-[15px] font-semibold",
                i === 0 && "text-primary dark:text-accent",
              )}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <span className="font-heading text-xl font-bold">Upcoming</span>
          <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex min-h-[80px] items-center gap-4 px-4 py-3">
                <Skeleton className="size-14 shrink-0 rounded-2xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-56 max-w-full" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </div>
                <Skeleton className="hidden h-7 w-28 rounded-full sm:block" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SkeletonContainer>
  );
}
