import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors `HouseholdDetail`. The family's name and people shimmer; the section
 * titles, their descriptions and the buttons are real text.
 */
export default function FamilyLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="family">
      <span className="-mb-4 inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-semibold text-muted-foreground">
        <ArrowLeft className="size-5" aria-hidden />
        All families
      </span>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
          <Skeleton className="h-6 w-72 max-w-full" />
        </div>
      </header>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-xl">People in this family</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <ul className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-44" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                  <Skeleton className="h-11 w-56 rounded-[10px]" />
                </div>
                <Skeleton className="h-11 w-60 rounded-[10px]" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5" aria-hidden />
            Also allowed to pick up
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Someone outside the family, like a grandparent or a neighbor, who
            this family says may pick up their children.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Skeleton className="h-5 w-56" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="size-5" aria-hidden />
            This week&rsquo;s pickup code
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Read this out to a parent who can&apos;t open their phone. It
            changes by itself every week.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled>
              <KeyRound aria-hidden />
              Show the code
            </Button>
          </div>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
