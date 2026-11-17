import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { ARTWORK_CROPS, ARTWORK_SPECS } from "@/lib/media/artwork";

export function ArtworkPanelSkeleton({ series = false }: { series?: boolean }) {
  return (
    <SkeletonContainer label={series ? "Series artwork" : "Artwork"}>
      <Card>
        <CardContent className="flex flex-col gap-5 pt-6">
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-lg font-bold">{series ? "Series artwork" : "Artwork"}</h3>
            <SkeletonText lines={2} size="sm" />
          </div>
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-5">
            {ARTWORK_CROPS.map(crop => {
              const spec = ARTWORK_SPECS[crop];
              return <div key={crop} className="flex min-w-0 flex-col gap-2">
                <p className="text-sm font-semibold">{spec.label}</p>
                <Skeleton className="w-full rounded-lg border border-border" style={{ aspectRatio: String(spec.ratio) }} />
                <Button type="button" variant="outline" disabled className="w-full min-w-0 whitespace-normal px-3 text-center">Replace image</Button>
                <Button type="button" variant="ghost" disabled className="w-full min-w-0 gap-2 whitespace-normal px-3 text-center"><Trash2 className="size-4" aria-hidden />Remove</Button>
                <p className="text-sm leading-snug text-muted-foreground">{spec.hint}</p>
              </div>;
            })}
          </div>
        </CardContent>
      </Card>
    </SkeletonContainer>
  );
}
