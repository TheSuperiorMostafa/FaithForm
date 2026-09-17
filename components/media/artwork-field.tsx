"use client";

import { useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import type { Area } from "react-easy-crop";

import {
  clearMediaArtwork,
  uploadMediaArtwork,
  type ArtworkTarget,
} from "@/app/dashboard/live-streaming/media/actions";
import { Button } from "@/components/ui/button";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { ARTWORK_SPECS, type ArtworkCrop } from "@/lib/media/artwork";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { cn } from "@/lib/utils";

/**
 * One crop of one thing's artwork.
 *
 * Always opens the cropper — there is no free-form path, unlike the website's
 * logo field. A shelf lays tiles out on a fixed ratio, so an uncropped image
 * would either be letterboxed or centre-cropped without the church having any
 * say in which half of the photo survives.
 */
export function ArtworkField({
  target,
  crop,
  value,
  inherited,
  onChanged,
  disabled,
}: {
  target: ArtworkTarget;
  crop: ArtworkCrop;
  /** This row's own URL. Null means nothing set here. */
  value: string | null;
  /**
   * What would show if nothing is set here — the series image, for an item.
   * Rendered at reduced emphasis so a church can see it is inheriting rather
   * than wondering why the slot looks both empty and full.
   */
  inherited?: string | null;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const spec = ARTWORK_SPECS[crop];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);

  const busy = pending || preparing;
  const showing = value ?? inherited ?? null;
  const isInherited = !value && Boolean(inherited);

  function upload(file: File, area: Area) {
    setError(null);
    const data = new FormData();
    data.set("file", file);
    data.set("crop", spec.key);
    data.set("targetKind", target.kind);
    data.set("targetId", target.id);
    data.set("cropX", String(area.x));
    data.set("cropY", String(area.y));
    data.set("cropWidth", String(area.width));
    data.set("cropHeight", String(area.height));

    startTransition(async () => {
      const result = await uploadMediaArtwork(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  async function accept(file: File) {
    setError(null);
    setPreparing(true);

    let ready: File;
    try {
      // Must happen before the cropper opens: the cropper reports its
      // rectangle in source-image pixels, so resizing afterwards would leave
      // those coordinates pointing at an image that no longer exists.
      ready = await downscaleForUpload(file);
    } finally {
      setPreparing(false);
    }

    if (ready.size > UPLOAD_BUDGET_BYTES) {
      setError("That photo is too large to upload. Save it as a JPG and try again.");
      return;
    }

    setCropping(ready);
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const result = await clearMediaArtwork({ target, crop });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{spec.label}</p>
        {isInherited ? (
          <span className="text-xs text-muted-foreground">From series</span>
        ) : null}
      </div>

      {showing ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- church-supplied storage URL */}
          <img
            src={showing}
            alt=""
            className={cn(
              "w-full rounded-lg border border-border bg-background object-cover",
              isInherited && "opacity-60",
            )}
            style={{ aspectRatio: String(spec.ratio) }}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {isInherited ? "Override" : "Replace"}
            </Button>
            {value ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                onClick={clear}
              >
                <Trash2 className="mr-1 size-3.5" />
                {inherited ? "Use series" : "Remove"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-6 text-center transition-colors hover:border-accent hover:bg-accent/5 disabled:opacity-60"
          style={{ aspectRatio: String(spec.ratio) }}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ImageUp className="size-5 text-muted-foreground" aria-hidden />
          )}
          <span className="text-xs font-medium text-accent">
            {busy ? (preparing ? "Preparing…" : "Uploading…") : "Add artwork"}
          </span>
        </button>
      )}

      <p className="text-xs leading-snug text-muted-foreground">{spec.hint}</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so picking the same file twice still fires a change.
          event.target.value = "";
          if (file) void accept(file);
        }}
      />

      {cropping ? (
        <ImageCropper
          file={cropping}
          shape={{ label: spec.label, hint: spec.hint, ratio: spec.ratio }}
          onCancel={() => setCropping(null)}
          onConfirm={(area) => {
            const file = cropping;
            setCropping(null);
            upload(file, area);
          }}
        />
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
