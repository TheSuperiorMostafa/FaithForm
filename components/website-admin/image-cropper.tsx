"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";

/**
 * Crop-to-fit before upload.
 *
 * Returns a crop rectangle in *source-image pixels*, not a canvas blob. The
 * actual crop happens server-side with sharp, so a 4000px photo is cut from the
 * original rather than from a downscaled canvas copy — the difference is
 * visible on the wide banner, where a canvas round-trip shows softening.
 *
 * The frame is locked to the aspect the site renders at. That is the whole
 * point: without it, `object-fit: cover` silently centre-crops and a church has
 * no say in which part of the photo survives.
 */
/** What the frame locks to, and what the church is told about it. */
export type CropShape = { label: string; hint: string; ratio: number | null };

export function ImageCropper({
  file,
  aspectKey,
  shape,
  onCancel,
  onConfirm,
}: {
  file: File;
  /** A website aspect. Ignored when `shape` is given. */
  aspectKey?: ImageAspectKey;
  /**
   * An explicit shape, for callers outside the website builder. Media artwork
   * ratios come from `design/faithform/tokens.json` rather than from the
   * site's rendered column widths, so they cannot be expressed as an
   * `ImageAspectKey` without putting them in the wrong file.
   */
  shape?: CropShape;
  onCancel: () => void;
  onConfirm: (crop: Area) => void;
}) {
  const aspect: CropShape = shape ?? getAspect(aspectKey);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Object URLs leak until revoked, and a church may open the cropper many
  // times while trying photos.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        showClose={false}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-w-3xl overflow-hidden"
      >
        <DialogHeader className="px-5 py-4">
          <DialogTitle id={titleId}>Position your photo</DialogTitle>
          <DialogDescription id={descriptionId}>
            {aspect.label} — {aspect.hint} Drag to move, and zoom to fill the
            frame. Everything outside it is trimmed off.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-auto overflow-y-auto p-5">
          <div className="relative h-[min(380px,50dvh)] min-h-[120px] overflow-hidden rounded-xl bg-muted">
            {src ? (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={aspect.ratio ?? 1}
                minZoom={1}
                maxZoom={5}
                zoomSpeed={0.2}
                restrictPosition
                showGrid
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))))}
            >
              <Minus className="size-4" />
            </Button>

            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
              <Maximize2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="sr-only">Zoom</span>
              <input
                type="range"
                min={1}
                max={5}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-accent"
              />
            </label>

            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(5, Number((z + 0.2).toFixed(2))))}
            >
              <Plus className="size-4" />
            </Button>

            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="mr-1 size-4" />
              Reset
            </Button>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end px-5 py-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!pixels}
            onClick={() => pixels && onConfirm(pixels)}
          >
            Use this photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
