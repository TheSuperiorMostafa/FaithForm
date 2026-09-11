"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import { downscaleForUpload } from "@/lib/sites/downscale-image";

type ThemeUploadButtonProps = {
  onUploaded: (theme: SlideTheme) => void;
};

async function readError(res: Response): Promise<string> {
  // A body over the platform's limit is refused before the route runs, and
  // that refusal is not JSON. Reading it as JSON first turned the real message
  // into "Unexpected token" for the person who picked the photo.
  if (res.status === 413) return "That image is too large. Try one under 4MB.";
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? "Could not upload that image";
  } catch {
    return `Could not upload that image (${res.status}).`;
  }
}

export function ThemeUploadButton({ onUploaded }: ThemeUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", await downscaleForUpload(file));

      const res = await fetch("/api/sermon/themes/upload", {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error(await readError(res));

      const data = (await res.json()) as { theme?: SlideTheme };
      if (!data.theme) throw new Error("Could not upload that image");
      onUploaded(data.theme);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload that image");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <ImagePlus className="size-4" />
            Upload your own theme
          </>
        )}
      </Button>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          JPG, PNG, or WebP. Large photos are shrunk to fit on the way up. Saved
          under Uploads so you can reuse it.
        </p>
      )}
    </div>
  );
}
