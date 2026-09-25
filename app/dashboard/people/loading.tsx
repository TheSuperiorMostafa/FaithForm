import { Plus, Search } from "lucide-react";

import { PEOPLE_DESCRIPTION, PeopleTabs } from "@/components/people/people-tabs";
import { Button } from "@/components/ui/button";
import { List } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors `PeopleManager`: the same header, links, search, filter chips and
 * list rows. Words that never change are real text; only the people and the
 * counts shimmer.
 */
export default function PeopleLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-8 pb-28 sm:pb-0"
      label="people"
    >
      <PageHeader
        title="People"
        description={PEOPLE_DESCRIPTION}
        action={
          <Button type="button" size="lg" className="hidden sm:inline-flex" disabled>
            <Plus aria-hidden />
            Add person
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
            Search by name, phone or email
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {["Everyone", "No phone", "Inactive"].map((label) => (
              <span
                key={label}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-[15px] font-semibold text-foreground/80"
              >
                {label}
                <Skeleton className="h-4 w-5" />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[15px] font-medium text-muted-foreground">
            <span className="shrink-0">Sort by</span>
            <div className="flex min-h-11 w-32 items-center rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm">
              Last name
            </div>
          </div>
        </div>

        <List>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="flex items-center gap-2 rounded-2xl">
              <div className="flex min-h-[72px] min-w-0 flex-1 items-center gap-4 px-4 py-3">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className={i % 3 === 0 ? "h-5 w-44" : i % 3 === 1 ? "h-5 w-36" : "h-5 w-52"} />
                  <Skeleton className="h-4 w-28" />
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
