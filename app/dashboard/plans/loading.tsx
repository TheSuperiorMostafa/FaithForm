import { ListOrdered, Music } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { PLANS_DESCRIPTION, PLANS_TITLE } from "@/lib/service-plans/page-copy";

/** Mirrors `page.tsx`: header with its real button, then the service type cards. */
export default function ServicePlansLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="service plans">
      <PageHeader
        title={PLANS_TITLE}
        description={PLANS_DESCRIPTION}
        icon={ListOrdered}
        secondary={
          <span aria-hidden className={buttonVariants({ variant: "outline", size: "lg" })}>
            <Music className="size-5" />
            Song library
          </span>
        }
      />
      <ul aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <li
            key={i}
            className="flex min-h-[168px] flex-col justify-between gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
          >
            <Skeleton className="h-6 w-40" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-52 max-w-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-44 max-w-full" />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonContainer>
  );
}
