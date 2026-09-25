import { Plus, Search } from "lucide-react";

import { FAMILIES_DESCRIPTION, PeopleTabs } from "@/components/people/people-tabs";
import { Button } from "@/components/ui/button";
import { List } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors `HouseholdsDirectory`: header, links, search, then family rows. */
export default function HouseholdsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="families">
      <PageHeader
        title="Families"
        description={FAMILIES_DESCRIPTION}
        action={
          <Button type="button" size="lg" disabled>
            <Plus aria-hidden />
            New family
          </Button>
        }
      />

      <PeopleTabs />

      <div className="flex flex-col gap-5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <div className="flex min-h-14 w-full items-center rounded-2xl border-[1.5px] border-border bg-card pl-14 pr-5 text-lg text-muted-foreground shadow-sm">
            Search by family name or anyone in it
          </div>
        </div>

        <List>
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2 rounded-2xl">
              <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-4 px-4 py-3">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className={i % 2 === 0 ? "h-5 w-48" : "h-5 w-40"} />
                  <Skeleton className="h-4 w-64 max-w-full" />
                </div>
                <Skeleton className="size-5 shrink-0 rounded" />
              </div>
            </li>
          ))}
        </List>
      </div>
    </SkeletonContainer>
  );
}
