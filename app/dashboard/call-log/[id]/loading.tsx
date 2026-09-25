import { ArrowLeft, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

/** Mirrors `[id]/page.tsx`: back link, caller header, summary card, transcript. */
export default function CallDetailLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="call">
      <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
        <ArrowLeft aria-hidden className="size-5" />
        Back to Phone Calls
      </span>

      <header className="flex flex-col gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-80 max-w-full" />
        </div>
      </header>

      <div className="flex w-full flex-col gap-6">
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-xl">What they wanted</CardTitle>
              <Skeleton className="h-7 w-36 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <SkeletonText lines={3} />
            <Skeleton className="h-12 w-48 rounded-[10px]" />
          </CardContent>
        </Card>

        <div className="rounded-2xl border border-border bg-card/50">
          <div className="flex min-h-12 items-center justify-between gap-3 px-5 py-3">
            <span className="space-y-0.5">
              <span className="block text-[15px] font-semibold text-foreground">Read the transcript</span>
              <span className="block text-sm text-muted-foreground">
                Everything that was said on the call, word for word.
              </span>
            </span>
            <ChevronDown aria-hidden className="size-5 text-muted-foreground" />
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
