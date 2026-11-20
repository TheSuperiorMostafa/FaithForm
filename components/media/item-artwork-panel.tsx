"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import type { ArtworkTarget } from "@/app/dashboard/live-streaming/media/actions";
import { ArtworkField } from "@/components/media/artwork-field";
import { CreateArtworkButton } from "@/components/media/create-artwork-button";
import { Card, CardContent } from "@/components/ui/card";
import { ARTWORK_CROPS, hasAnyArtwork, type ArtworkSet } from "@/lib/media/artwork";

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
  target,
  artwork,
  seriesArtwork,
  seriesName,
  seriesSlug,
  title = "",
}: {
  /** The message title, which "Create one for me" makes its picture from. */
  title?: string;
  artwork: ArtworkSet;
  seriesArtwork: ArtworkSet;
  seriesName: string | null;
  seriesSlug: string | null;
} & ({ recordingId: string; target?: never } | { recordingId?: never; target: ArtworkTarget })) {
  const router = useRouter();

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
            <h3 className="font-heading text-lg font-bold">Artwork</h3>
            <p className="text-sm text-muted-foreground">
              {seriesName && seriesSlug ? (
                <>
                  Uses the artwork from{" "}
                  <Link
                    href={`/dashboard/live-streaming/recordings/series/${seriesSlug}`}
                    className="font-medium text-accent underline underline-offset-4"
                  >
                    {seriesName}
                  </Link>
                  . Change one only if this message needs its own.
                </>
              ) : (
                "Pictures shown instead of the title. Choose one to view or change it."
              )}
            </p>
          </div>
          <CreateArtworkButton
            target={target ?? { kind: "item", id: recordingId! }}
            title={title}
            hasArtwork={hasAnyArtwork(artwork)}
            onCreated={() => router.refresh()}
          />
        </div>

        <div className="grid min-w-0 grid-cols-3 gap-3">
          {ARTWORK_CROPS.map((crop) => (
            <ArtworkField
              key={crop}
              target={target ?? { kind: "item", id: recordingId! }}
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
