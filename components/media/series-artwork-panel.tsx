"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { applySeriesArtworkToItems } from "@/app/dashboard/live-streaming/media/actions";
import { ArtworkField } from "@/components/media/artwork-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ARTWORK_CROPS, hasAnyArtwork, type ArtworkSet } from "@/lib/media/artwork";

/**
 * The three crops for a series, and the one action that makes them count.
 *
 * This panel is the highest-leverage screen in the media library. A church
 * publishes forty items a year and runs six series; three images per item is a
 * hundred and twenty nobody will make, and three per series is eighteen. Every
 * item inside inherits them, so this is where a grey library becomes a
 * designed one.
 */
export function SeriesArtworkPanel({
  seriesId,
  artwork,
  itemCount,
  overriddenCount,
}: {
  seriesId: string;
  artwork: ArtworkSet;
  itemCount: number;
  /** Items in this series carrying their own artwork, which wins over these. */
  overriddenCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function applyToAll() {
    setError(null);
    setNotice(null);

    startTransition(async () => {
      // One call per crop. Sequential rather than parallel: they write to the
      // same rows, and three concurrent updates to one row is a lost update
      // waiting to happen.
      let cleared = 0;
      for (const crop of ARTWORK_CROPS) {
        const result = await applySeriesArtworkToItems({ seriesId, crop });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        cleared += result.count;
      }

      setNotice(
        cleared === 0
          ? "Every message in this series was already using the series artwork."
          : `${cleared === 1 ? "1 message" : `${cleared} messages`} now use the series artwork.`,
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-base font-bold">Series artwork</h3>
          <p className="text-sm text-muted-foreground">
            {itemCount === 0
              ? "Set these now and anything you file into this series picks them up automatically."
              : `Inherited by every message in this series that doesn't have its own.`}
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          {ARTWORK_CROPS.map((crop) => (
            <ArtworkField
              key={crop}
              target={{ kind: "series", id: seriesId }}
              crop={crop}
              value={artwork[crop]}
              onChanged={() => router.refresh()}
              disabled={pending}
            />
          ))}
        </div>

        {/* Only offered when it would do something. An "apply to all" button
            that always reports "0 changed" teaches a church to distrust it. */}
        {overriddenCount > 0 && hasAnyArtwork(artwork) ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-sm">
              {overriddenCount === 1
                ? "1 message in this series has its own artwork"
                : `${overriddenCount} messages in this series have their own artwork`}
              , so they ignore the images above.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={applyToAll}
              >
                {pending ? "Applying…" : "Use series artwork everywhere"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Clears the individual images. Future changes here apply to all of them.
              </p>
            </div>
          </div>
        ) : null}

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
