"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import type { Area } from "react-easy-crop";

import {
  clearMediaArtwork,
  uploadMediaArtwork,
  type ArtworkTarget,
} from "@/app/dashboard/live-streaming/media/actions";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
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
type ArtworkFieldProps = {
  target: ArtworkTarget;
  crop: ArtworkCrop;
  value: string | null;
  inherited?: string | null;
  onChanged: () => void;
  disabled?: boolean;
};

export function ArtworkField(props: ArtworkFieldProps) {
  // A crop in progress belongs to this exact item, even when a parent reuses
  // the field while navigating between recordings.
  return <ArtworkEditor key={`${props.target.kind}:${props.target.id}:${props.crop}`} {...props} />;
}

function ArtworkEditor({
  target,
  crop,
  value,
  inherited,
  onChanged,
  disabled,
}: ArtworkFieldProps) {
  const spec = ARTWORK_SPECS[crop];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropping, setCropping] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<{ before: string | null; url: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef<"preparing" | "cropping" | "uploading" | "confirming" | "clearing" | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (saved && value !== saved.before) setSaved(null); }, [value, saved]);

  const busy = pending || preparing || confirming;
  const ownImage = saved && value === saved.before ? saved.url : value;
  const showing = ownImage ?? inherited ?? null;
  const isInherited = !ownImage && Boolean(inherited);

  function upload(file: File, area: Area) {
    if (disabled || operation.current !== "cropping") return;
    operation.current = "uploading";
    setCropping(null);
    setError(null);
    setNotice(null);
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
      try {
        const result = await uploadMediaArtwork(data);
        if (!mounted.current) return;
        if (!result.ok) { setError(result.error); return; }
        setSaved({ before: value, url: result.url });
        setNotice("Image saved.");
        onChanged();
      } catch {
        if (mounted.current) setError("We couldn't confirm the image was saved. Refresh to check it, then choose the image again if needed.");
      } finally {
        operation.current = null;
      }
    });
  }

  async function accept(file: File) {
    if (disabled || operation.current) return;
    operation.current = "preparing";
    setError(null);
    setNotice(null);
    setPreparing(true);

    let ready: File;
    try {
      // Must happen before the cropper opens: the cropper reports its
      // rectangle in source-image pixels, so resizing afterwards would leave
      // those coordinates pointing at an image that no longer exists.
      ready = await downscaleForUpload(file);
    } catch {
      if (mounted.current) setError("We couldn't open that image. Try a JPG, PNG, or HEIC photo, or choose the file again.");
      operation.current = null;
      return;
    } finally {
      if (mounted.current) setPreparing(false);
    }

    if (!mounted.current) return;
    if (ready.size > UPLOAD_BUDGET_BYTES) {
      operation.current = null;
      setError("That photo is too large to upload. Save it as a JPG and try again.");
      return;
    }

    operation.current = "cropping";
    setCropping(ready);
  }

  async function clear() {
    if (disabled || operation.current) return;
    operation.current = "confirming";
    setConfirming(true);
    // No undo is possible here (the old image can't be re-attached without
    // uploading it again), so removing asks first.
    let ok = false;
    try { ok = await confirmAction({
      title: inherited ? "Go back to the series image?" : `Remove this ${spec.label.toLowerCase()} image?`,
      description: inherited
        ? "This message stops using its own image and shows the series artwork instead."
        : "It disappears from the app and your website. You can add another image any time.",
      confirmLabel: inherited ? "Use series image" : "Remove image",
      cancelLabel: "Keep it",
      destructive: true,
    }); } catch {
      if (mounted.current) setError("We couldn't open that choice. Try removing the image again.");
    } finally { if (mounted.current) setConfirming(false); }
    if (!ok || !mounted.current) { operation.current = null; return; }
    operation.current = "clearing";
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await clearMediaArtwork({ target, crop });
        if (!mounted.current) return;
        if (!result.ok) { setError(result.error); return; }
        setSaved({ before: value, url: null });
        setNotice(inherited ? "Using the series image." : "Image removed.");
        onChanged();
      } catch {
        if (mounted.current) setError("We couldn't confirm the image was removed. Refresh to check it, then try again if needed.");
      } finally {
        operation.current = null;
      }
    });
  }

  return (
    <div className="flex flex-col gap-2" aria-busy={busy}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{spec.label}</p>
        {isInherited ? (
          <span className="text-sm text-muted-foreground">From series</span>
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
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              {isInherited ? "Use its own image" : "Replace image"}
            </Button>
            {ownImage ? (
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() => void clear()}
                className="gap-2"
              >
                <Trash2 className="size-4" aria-hidden />
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
          <span className="text-sm font-medium text-primary dark:text-accent">
            {busy ? (preparing ? "Preparing…" : "Uploading…") : "Add artwork"}
          </span>
        </button>
      )}

      <p className="text-sm leading-snug text-muted-foreground">{spec.hint}</p>

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
          onCancel={() => { operation.current = null; setCropping(null); }}
          onConfirm={(area) => {
            const file = cropping;
            upload(file, area);
          }}
        />
      ) : null}

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {busy && showing ? <p role="status" className="text-sm text-muted-foreground">{confirming ? "Waiting for your choice…" : preparing ? "Preparing image…" : "Saving image…"}</p> : null}
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    </div>
  );
}
