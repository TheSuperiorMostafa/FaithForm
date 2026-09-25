import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors Website → Sermons: header with "Add sermon", then the sermon list. */
export default function WebsiteSermonsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="website sermons">
      <SectionHeader
        title="Sermons"
        description="The sermons listed in the Sermons section of your website. New ones show up straight away."
        action={
          <Button type="button" size="lg" disabled>
            <Plus className="size-5" aria-hidden /> Add sermon
          </Button>
        }
      />

      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex min-h-[72px] flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-56 max-w-full" />
                <Skeleton className="h-7 w-32 rounded-full" />
              </div>
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-11 w-24 rounded-[10px]" />
              <Skeleton className="h-11 w-28 rounded-[10px]" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonContainer>
  );
}
