"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ImageUp, Link2, Loader2, Trash2 } from "lucide-react";

import { uploadSiteImage } from "@/app/dashboard/website/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  /** Square preview suits logos and headshots; wide suits section photography. */
  aspect = "wide",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  help?: string;
  disabled?: boolean;
  className?: string;
  aspect?: "wide" | "square";
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const [dragging, setDragging] = useState(false);

  function upload(file: File) {
    setError(null);
    const data = new FormData();
    data.set("file", file);

    startTransition(async () => {
      const result = await uploadSiteImage(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChange(result.url);
    });
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
    upload(file);
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

      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}

      {value ? (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied storage URL */}
          <img
            src={value}
            alt=""
            className={cn(
              "shrink-0 rounded-md border border-border object-cover",
              aspect === "square" ? "size-16" : "h-16 w-28",
            )}
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
          if (file) upload(file);
        }}
      />

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
