import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown } from "lucide-react";
import { BRAND_SWATCHES } from "@/lib/branding/brand-colors";

/** Inside the page's SkeletonContainer or a section's Suspense fallback. */
export function BrandColorsSkeleton({ appEnabled = true }: { appEnabled?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{appEnabled ? "App colors" : "Colors"}</CardTitle>
        <CardDescription className="text-[15px]">
          {appEnabled
            ? "Used across your church's app and giving page. Tap a pair to use it."
            : "Used on your church's giving page. Tap a pair to use it."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="choice-grid choice-grid-3">
          {BRAND_SWATCHES.map(swatch => <div key={swatch.name} className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-border bg-background px-4 py-3">
            <span aria-hidden className="flex shrink-0 -space-x-2">
              <span className="size-9 rounded-full border-2 border-background" style={{ backgroundColor: swatch.primary }} />
              <span className="size-9 rounded-full border-2 border-background" style={{ backgroundColor: swatch.accent }} />
            </span>
            <span className="min-w-0 flex-1 text-[15px] font-semibold">{swatch.name}</span>
            <Skeleton className="size-5 shrink-0" />
          </div>)}
        </div>
        <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border bg-card/50 px-5 py-3">
          <span className="space-y-0.5">
            <span className="block text-[15px] font-semibold">Custom color</span>
            <span className="block text-sm text-muted-foreground">Match your church&apos;s own colors exactly.</span>
          </span>
          <ChevronDown className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}
