"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";
import { cn } from "@/lib/utils";

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
export function ImageCropper({
  file,
  aspectKey,
  onCancel,
  onConfirm,
}: {
  file: File;
  aspectKey: ImageAspectKey;
  onCancel: () => void;
  onConfirm: (crop: Area) => void;
}) {
  const aspect = getAspect(aspectKey);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Object URLs leak until revoked, and a church may open the cropper many
  // times while trying photos.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setPixels(areaPixels);
  }, []);

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop image"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card outline-none"
      >
        <div>
          <h2 className="font-heading text-lg font-bold">Position your photo</h2>
          <p className="text-sm text-muted-foreground">
            {aspect.label} — {aspect.hint} Drag to move, and zoom to fill the
            frame. Everything outside it is trimmed off.
          </p>
        </div>

        <div className="relative h-[380px] overflow-hidden rounded-xl bg-muted">
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

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))))}
          >
            <Minus className="size-4" />
          </Button>

          <label className="flex min-w-0 flex-1 items-center gap-2">
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

        <div className={cn("flex justify-end gap-2")}>
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
        </div>
      </div>
    </div>
  );
}
