"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { ImageUp, Link2, Loader2, Trash2 } from "lucide-react";

import type { Area } from "react-easy-crop";

import { uploadSiteImage, type UploadResult } from "@/app/dashboard/website/actions";
import { registerWebsiteEditor } from "@/components/website-admin/editor-save-guard";
import type { SaveResult } from "@/components/website-admin/autosave-queue";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { getAspect, type ImageAspectKey } from "@/lib/sites/image-aspects";
import { cn } from "@/lib/utils";

/** Ignore async work belonging to a removed field or an abandoned image choice. */
export function createImageUploadGuard() {
  let mounted = true;
  let revision = 0;
  return {
    start: () => ++revision,
    isCurrent: (operation: number) => mounted && operation === revision,
    invalidate: () => { revision += 1; },
    mount: () => { mounted = true; },
    unmount: () => { mounted = false; revision += 1; },
  };
}

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
  onRecoverUpload,
  help,
  disabled,
  className,
  /**
   * Which shape the site renders this image at. Anything other than "free"
   * opens the cropper so the church chooses the framing rather than letting
   * object-fit centre-crop for them.
   */
  aspect = "free",
  /**
   * Where the file goes. Defaults to the website's upload; the member app's
   * church page passes its own, which is not gated on the Website feature.
   */
  uploadAction = uploadSiteImage,
  /** Extra classes for the thumbnail, e.g. to keep a large preview compact. */
  previewClassName,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  /** Retain an upload after its whole editor leaves; never apply it to a removed item. */
  onRecoverUpload?: (url: string) => void;
  help?: string;
  disabled?: boolean;
  className?: string;
  aspect?: ImageAspectKey;
  uploadAction?: (data: FormData) => Promise<UploadResult>;
  previewClassName?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const guardRef = useRef<ReturnType<typeof createImageUploadGuard> | null>(null);
  if (!guardRef.current) guardRef.current = createImageUploadGuard();
  const guard = guardRef.current;
  useEffect(() => {
    mounted.current = true;
    guard.mount();
    return () => { mounted.current = false; guard.unmount(); };
  }, [guard]);
  // An upload can finish after the rest of this section has been edited.
  // Use the latest callback so its new URL cannot restore an older form draft.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRecoverUploadRef = useRef(onRecoverUpload);
  onRecoverUploadRef.current = onRecoverUpload;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  // Shrinking a 12MP photo takes a beat, and it happens before the upload
  // starts, so it needs its own flag to hold the spinner open.
  const [preparing, setPreparing] = useState(false);

  const operation = useRef<{ promise: Promise<SaveResult>; resolve: (result: SaveResult) => void; revision: number } | null>(null);
  useEffect(() => registerWebsiteEditor({
    get hasUnsavedChanges() { return operation.current !== null; },
    flush: () => operation.current?.promise ?? Promise.resolve({ ok: true }),
  }), []);

  function finish(result: SaveResult) {
    operation.current?.resolve(result);
    operation.current = null;
  }

  const preset = getAspect(aspect);
  const busy = pending || preparing;

  function upload(file: File, crop?: Area) {
    const revision = operation.current?.revision;
    if (revision === undefined || !guard.isCurrent(revision)) return;
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
      try {
        const result = await uploadAction(data);
        if (mounted.current && !guard.isCurrent(revision)) return;
        if (!result.ok) {
          setError(result.error);
          finish(result);
          return;
        }
        // Commit the URL before resolving the upload guard, so its parent
        // autosave is queued before a page/full-screen transition can proceed.
        if (mounted.current) flushSync(() => onChangeRef.current(result.url));
        else onRecoverUploadRef.current?.(result.url);
        finish({ ok: true });
      } catch (cause) {
        console.error("[website] Photo upload failed:", cause);
        const message = "We couldn’t upload that photo. Your current photo is kept. Choose the photo again to retry.";
        setError(message);
        finish({ ok: false, error: message });
      }
    });
  }

  /**
   * Shaped images go through the cropper; free-form ones upload straight away.
   *
   * The shrink has to happen first, before the cropper opens, because the
   * cropper reports its rectangle in source-image pixels. Resizing afterwards
   * would leave those coordinates pointing at an image that no longer exists.
   */
  async function accept(file: File) {
    setError(null);
    if (disabled || busy || operation.current) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn’t an image. Choose a JPG or PNG photo.");
      return;
    }
    let resolve!: (result: SaveResult) => void;
    const promise = new Promise<SaveResult>(done => { resolve = done; });
    const revision = guard.start();
    operation.current = { promise, resolve, revision };
    setPreparing(true);

    let ready: File;
    try {
      ready = await downscaleForUpload(file);
    } catch (cause) {
      console.error("[website] Photo preparation failed:", cause);
      const message = "We couldn’t prepare that photo. Choose a JPG or PNG image and try again.";
      setError(message);
      finish({ ok: false, error: message });
      return;
    } finally {
      setPreparing(false);
    }

    // Only a file the browser could not decode, a HEIC outside Safari being
    // the realistic case, arrives here still oversized. Saying so beats
    // letting the request die at the server's body limit, which surfaces as an
    // error nobody wrote.
    if (ready.size > UPLOAD_BUDGET_BYTES) {
      const message = "That photo is too large to upload. Save it as a JPG and try again.";
      setError(message);
      finish({ ok: false, error: message });
      return;
    }

    if (!mounted.current || !guard.isCurrent(revision)) { finish({ ok: true }); return; }
    if (preset.ratio === null) {
      upload(ready);
      return;
    }
    setCropping(ready);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (disabled || busy) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't an image.");
      return;
    }
    void accept(file);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={inputId} className="text-sm font-semibold">
          {label}
        </Label>
        <button
          type="button"
          disabled={disabled || busy}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => setShowUrl((s) => !s)}
        >
          <Link2 className="size-3" aria-hidden />
          {showUrl ? "Hide link" : "Use a link instead"}
        </button>
      </div>

      {help || preset.ratio ? (
        <p className="text-sm text-muted-foreground">
          {[help, preset.ratio ? preset.hint : null].filter(Boolean).join(" ")}
        </p>
      ) : null}

      {value ? (
        // Preview above, controls below. Side-by-side collapses on the wide
        // banner preset, where the thumbnail is nearly six times as wide as it
        // is tall and leaves no room for anything beside it. The storage URL is
        // deliberately not shown — it is long, opaque, and of no use to anyone
        // editing their own site.
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied storage URL */}
          <img
            src={value}
            alt=""
            className={cn(
              "w-full rounded-md border border-border bg-background",
              preset.ratio ? "object-cover" : "max-h-40 object-contain",
              previewClassName,
            )}
            style={preset.ratio ? { aspectRatio: String(preset.ratio) } : undefined}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || busy}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled || busy}
              onClick={() => {
                guard.invalidate();
                setError(null);
                onChange("");
              }}
            >
              <Trash2 className="mr-1 size-4" />
              Remove
            </Button>
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
          {busy ? (
            <>
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {preparing ? "Preparing…" : "Uploading…"}
              </p>
            </>
          ) : (
            <>
              <ImageUp className="size-5 text-muted-foreground" aria-hidden />
              <p className="text-sm">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center font-semibold text-accent underline underline-offset-4"
                  disabled={disabled || busy}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose a photo
                </button>{" "}
                <span className="text-muted-foreground">or drag one here</span>
              </p>
              <p className="text-sm text-muted-foreground">
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
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so picking the same file twice still fires a change.
          e.target.value = "";
          if (file) void accept(file);
        }}
      />

      {cropping ? (
        <ImageCropper
          file={cropping}
          aspectKey={preset.key}
          onCancel={() => { guard.invalidate(); setCropping(null); finish({ ok: true }); }}
          onConfirm={(crop) => {
            const file = cropping;
            setCropping(null);
            upload(file, crop);
          }}
        />
      ) : null}

      {showUrl ? (
        <Input
          aria-label={`${label} web address`}
          placeholder="https://…"
          value={value}
          disabled={disabled || busy}
          onChange={(e) => { guard.invalidate(); onChange(e.target.value); }}
        />
      ) : null}

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
