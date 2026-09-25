import { Search } from "lucide-react";

import { DESK_SEARCH_LABEL, DESK_SEARCH_PLACEHOLDER } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the check-in desk before anyone types: the search box (static, so
 * real text), then "In the rooms now" with a card per room. The Kids Check-in
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
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, room) => (
            <Card key={room} className="flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Skeleton className="h-7 w-36" />
                <Skeleton className="h-8 w-44 rounded-full" />
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {Array.from({ length: 3 }).map((_, row) => (
                  <li key={row} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-40" />
                      <Skeleton className="h-5 w-28" />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] font-medium text-foreground">Move to</span>
                      <Skeleton className="h-11 w-48 rounded-[10px]" />
                    </div>
                  </li>
                ))}
              </ul>
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
