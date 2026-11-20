import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { ARTWORK_CROPS, ARTWORK_SPECS } from "@/lib/media/artwork";

/** Mirrors `ItemArtworkPanel` (and, with `series`, `SeriesArtworkPanel`): a header and three small thumbnails. */
export function ArtworkPanelSkeleton({ series = false }: { series?: boolean }) {
  const createButton = (
    <Button type="button" variant="outline" disabled className="self-start">
      <Sparkles className="size-4" aria-hidden />
      Create one for me
    </Button>
  );
  return (
    <SkeletonContainer label={series ? "Series artwork" : "Artwork"}>
      <Card>
        <CardContent className={series ? "flex flex-col gap-5 pt-6" : "flex flex-col gap-4 pt-6"}>
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
              <h3 className="font-heading text-lg font-bold">{series ? "Series artwork" : "Artwork"}</h3>
              <SkeletonText lines={2} size="sm" />
            </div>
            {series ? null : createButton}
          </div>
          {series ? createButton : null}
          <div className="grid min-w-0 grid-cols-3 gap-3">
            {ARTWORK_CROPS.map(crop => (
              <div key={crop} className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className="h-24 w-full rounded-lg border border-border" />
                <p className="truncate text-sm font-semibold">{ARTWORK_SPECS[crop].label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
