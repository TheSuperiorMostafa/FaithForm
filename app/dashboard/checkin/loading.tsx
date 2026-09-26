import { Search } from "lucide-react";

import { DESK_SEARCH_LABEL, DESK_SEARCH_PLACEHOLDER } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the check-in desk before anyone types: the search box (static, so
 * real text), then "In the rooms now" with a compact card per room. The Kids Check-in
 * header and links above come from the layout and are already real.
 */
export default function CheckinTodayLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="the check-in desk">
      <section className="flex flex-col gap-3">
        <p className="text-lg font-semibold text-foreground">{DESK_SEARCH_LABEL}</p>
        <div className="relative flex min-h-16 w-full items-center rounded-2xl border-2 border-border bg-background py-4 pl-14 pr-4 text-xl text-muted-foreground shadow-sm">
          <Search className="absolute left-5 top-1/2 size-6 -translate-y-1/2" aria-hidden />
          {DESK_SEARCH_PLACEHOLDER}
        </div>
      </section>

      <section className="flex flex-col gap-5">
        {/* SectionHeader's shape, with the date (data) as a placeholder. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-bold text-foreground">In the rooms now</h2>
            <Skeleton className="h-[22px] w-64 max-w-full" />
          </div>
        </div>
        {/* Closed room cards, as RosterBoard draws them: name and big count,
            the occupancy badge, a line of names, then the "Show all" button. */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, room) => (
            <Card key={room} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-[25px] w-32" />
                <Skeleton className="h-[30px] w-8" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-7 w-36 rounded-full" />
              </div>
              <Skeleton className="h-[22px] w-full" />
              <Skeleton className="h-11 w-full rounded-[10px]" />
            </Card>
          ))}
        </div>
      </section>

      <p className="text-[15px] text-muted-foreground">
        Children go home through Pick up, where the parent&rsquo;s code is
        checked. To change a family or who may pick up, go to People › Families.
      </p>
    </SkeletonContainer>
  );
}
