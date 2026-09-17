"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArtworkField } from "@/components/media/artwork-field";
import { Card, CardContent } from "@/components/ui/card";
import { ARTWORK_CROPS, type ArtworkSet } from "@/lib/media/artwork";

/**
 * Artwork for one recording.
 *
 * Shows the series image at reduced emphasis in any slot this item has not
 * overridden, so a church can see what is inherited rather than an empty box
 * next to a tile that visibly has a picture. Overriding is the exception: the
 * copy points at the series page, because setting it once there is almost
 * always the right move.
 */
export function ItemArtworkPanel({
  recordingId,
  artwork,
  seriesArtwork,
  seriesName,
  seriesSlug,
}: {
  recordingId: string;
  artwork: ArtworkSet;
  seriesArtwork: ArtworkSet;
  seriesName: string | null;
  seriesSlug: string | null;
}) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-base font-bold">Artwork</h3>
          <p className="text-sm text-muted-foreground">
            {seriesName && seriesSlug ? (
              <>
                This message inherits its artwork from{" "}
                <Link
                  href={`/dashboard/live-streaming/media/series/${seriesSlug}`}
                  className="font-medium text-accent underline underline-offset-4"
                >
                  {seriesName}
                </Link>
                . Override a shape here only if this one needs its own image.
              </>
            ) : (
              "Add images so this message shows a picture instead of its title. Filing it into a series lets it share one set of images with everything else in that series."
            )}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {ARTWORK_CROPS.map((crop) => (
            <ArtworkField
              key={crop}
              target={{ kind: "item", id: recordingId }}
              crop={crop}
              value={artwork[crop]}
              inherited={seriesArtwork[crop]}
              onChanged={() => router.refresh()}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
