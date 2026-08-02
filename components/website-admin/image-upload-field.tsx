"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ImageUp, Link2, Loader2, Trash2 } from "lucide-react";

import type { Area } from "react-easy-crop";

import { uploadSiteImage } from "@/app/dashboard/website/actions";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";
import { cn } from "@/lib/utils";

/**
 * Pick an image from the device, or paste a URL.
 *
 * Upload is the primary path — asking a pastor for an image URL is asking them
 * to find a file host first. The URL box stays available behind a toggle for
 * images already hosted somewhere (a denominational asset, a Google Drive
 * link), but it is not what the field opens on.
 */
export function ImageUploadField({
  label,
  value,
  onChange,
  help,
  disabled,
  className,
  /**
   * Which shape the site renders this image at. Anything other than "free"
   * opens the cropper so the church chooses the framing rather than letting
   * object-fit centre-crop for them.
   */
  aspect = "free",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  help?: string;
  disabled?: boolean;
  className?: string;
  aspect?: ImageAspectKey;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);

  const preset = getAspect(aspect);

  function upload(file: File, crop?: Area) {
    setError(null);
    const data = new FormData();
    data.set("file", file);
    data.set("aspect", preset.key);

    if (crop) {
      data.set("cropX", String(crop.x));
      data.set("cropY", String(crop.y));
      data.set("cropWidth", String(crop.width));
      data.set("cropHeight", String(crop.height));
    }

    startTransition(async () => {
      const result = await uploadSiteImage(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(result.url);
    });
  }

  /** Shaped images go through the cropper; free-form ones upload straight away. */
  function accept(file: File) {
    setError(null);
    if (preset.ratio === null) {
      upload(file);
      return;
    }
    setCropping(file);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled || pending) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image.");
      return;
    }
    accept(file);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId} className="text-sm font-semibold">
          {label}
        </Label>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => setShowUrl((s) => !s)}
        >
          <Link2 className="size-3" aria-hidden />
          {showUrl ? "Hide link" : "Use a link instead"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        {help ? `${help} ` : ""}
        {preset.ratio ? preset.hint : null}
      </p>

      {value ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied storage URL */}
          <img
            src={value}
            alt=""
            className="h-16 w-28 shrink-0 rounded-md border border-border object-cover"
            style={
              preset.ratio
                ? { aspectRatio: String(preset.ratio), width: "auto", height: 64 }
                : undefined
            }
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="truncate text-xs text-muted-foreground">{value}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || pending}
                onClick={() => inputRef.current?.click()}
              >
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || pending}
                onClick={() => {
                  setError(null);
                  onChange("");
                }}
              >
                <Trash2 className="mr-1 size-4" />
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-accent bg-accent/5" : "border-border bg-muted/20",
          )}
        >
          {pending ? (
            <>
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">Uploading…</p>
            </>
          ) : (
            <>
              <ImageUp className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm">
                <button
                  type="button"
                  className="font-semibold text-accent underline underline-offset-4"
                  disabled={disabled}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose a photo
                </button>{" "}
                <span className="text-muted-foreground">or drag one here</span>
              </p>
              <p className="text-xs text-muted-foreground">
                JPG, PNG, or a photo straight from your phone. Up to 12MB.
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled || pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file twice still fires a change.
          e.target.value = "";
          if (file) accept(file);
        }}
      />

      {cropping ? (
        <ImageCropper
          file={cropping}
          aspectKey={preset.key}
          onCancel={() => setCropping(null)}
          onConfirm={(crop) => {
            const file = cropping;
            setCropping(null);
            upload(file, crop);
          }}
        />
      ) : null}

      {showUrl ? (
        <Input
          placeholder="https://…"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
