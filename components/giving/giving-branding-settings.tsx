"use client";

import { useRef, useState, useTransition } from "react";
import { Palette } from "lucide-react";
import type { Area } from "react-easy-crop";
import {
  updateGivingBranding,
  uploadGivingLogo,
} from "@/app/dashboard/settings/giving-actions";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { cn } from "@/lib/utils";

type GivingBrandingSettingsProps = {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  className?: string;
};

export function GivingBrandingSettings({
  logoUrl,
  primaryColor,
  accentColor,
  className,
}: GivingBrandingSettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [primary, setPrimary] = useState(primaryColor ?? "#002D5F");
  const [accent, setAccent] = useState(accentColor ?? "#C5A059");
  const [cropping, setCropping] = useState<File | null>(null);
  // Shrinking a phone photo takes a beat before the cropper can open.
  const [preparing, setPreparing] = useState(false);

  /**
   * The logo is framed in the same square cropper the group photo uses. The
   * shrink comes first because the cropper reports source-image pixels, which
   * must describe the file that is actually uploaded.
   */
  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so choosing the same file again still opens the cropper.
    e.target.value = "";
    if (!file) return;

    setMessage(null);
    setPreparing(true);
    let ready: File;
    try {
      ready = await downscaleForUpload(file);
    } finally {
      setPreparing(false);
    }
    if (ready.size > UPLOAD_BUDGET_BYTES) {
      setMessage("That photo is too large to upload. Save it as a JPG and try again.");
      return;
    }
    setCropping(ready);
  };

  const uploadLogo = (file: File, crop: Area) => {
    const formData = new FormData();
    formData.set("logo", file);
    formData.set("crop", JSON.stringify(crop));
    startTransition(async () => {
      setMessage(null);
      const result = await uploadGivingLogo(formData);
      if (result.suggestedPrimaryColor && result.suggestedAccentColor) {
        setPrimary(result.suggestedPrimaryColor);
        setAccent(result.suggestedAccentColor);
        setMessage("Logo updated. We found two accessible color suggestions—review and save them.");
      } else {
        setMessage(result.error ?? "Logo updated. Choose colors below to finish your app theme.");
      }
      if (result.logoUrl) setPreview(result.logoUrl);
    });
  };

  const saveColors = () => {
    startTransition(async () => {
      setMessage(null);
      const result = await updateGivingBranding({
        primaryColor: primary,
        accentColor: accent,
      });
      setMessage(result.error ?? "Branding colors saved.");
    });
  };

  const resetColors = () => {
    startTransition(async () => {
      setMessage(null);
      const result = await updateGivingBranding({
        primaryColor: null,
        accentColor: null,
      });
      if (!result.error) {
        setPrimary("#002D5F");
        setAccent("#C5A059");
      }
      setMessage(result.error ?? "Colors reset to FaithForm defaults.");
    });
  };

  return (
    <div className={cn("space-y-4 border-t pt-4", className)}>
      <div>
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <Palette className="h-4 w-4 text-accent" />
          Church app theme
        </h4>
        <p className="text-xs text-muted-foreground">
          Your logo and colors personalize the entire member app and your public giving page.
          Upload a logo for smart suggestions, or choose your own colors.
        </p>
      </div>

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}

      <div className="space-y-2">
        <Label>Church logo</Label>
        <div className="flex flex-wrap items-center gap-4">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Church logo preview"
              className="size-14 rounded-md border border-border object-cover"
            />
          ) : (
            <div className="flex h-14 w-28 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              No logo
            </div>
          )}
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || preparing}
              onClick={() => fileRef.current?.click()}
            >
              {preparing ? "Preparing…" : preview ? "Replace logo" : "Upload logo"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">A square, 1:1 — the shape the apps show</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="giving-primary">Primary color</Label>
          <div className="flex items-center gap-2">
            <input
              id="giving-primary-picker"
              type="color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value.toUpperCase())}
              className="h-10 w-12 cursor-pointer rounded border border-border"
              aria-label="Primary color picker"
            />
            <Input
              id="giving-primary"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="#002D5F"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="giving-accent">Accent color</Label>
          <div className="flex items-center gap-2">
            <input
              id="giving-accent-picker"
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value.toUpperCase())}
              className="h-10 w-12 cursor-pointer rounded border border-border"
              aria-label="Accent color picker"
            />
            <Input
              id="giving-accent"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#C5A059"
            />
          </div>
        </div>
      </div>

      <div
        className="rounded-lg border border-border p-4"
        style={{
          backgroundColor: `${primary}14`,
          borderColor: `${accent}66`,
        }}
      >
        <p className="text-xs text-muted-foreground">App preview</p>
        <div className="mt-2 flex gap-2">
          <span
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{ backgroundColor: accent, color: primary }}
          >
            Selected amount
          </span>
          <span
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: primary, color: primary }}
          >
            Other amount
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={saveColors} disabled={pending}>
          Apply across app
        </Button>
        <Button type="button" variant="outline" onClick={resetColors} disabled={pending}>
          Reset to defaults
        </Button>
      </div>

      {cropping && (
        <ImageCropper
          file={cropping}
          aspectKey="logo"
          onCancel={() => setCropping(null)}
          onConfirm={(crop) => {
            const file = cropping;
            setCropping(null);
            uploadLogo(file, crop);
          }}
        />
      )}
    </div>
  );
}
