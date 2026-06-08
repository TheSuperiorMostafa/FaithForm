"use client";

import { useRef, useState, useTransition } from "react";
import {
  updateGivingBranding,
  uploadGivingLogo,
} from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GivingBrandingSettingsProps = {
  logoUrl: string | null;
  primaryColor: string | null;
  accentColor: string | null;
};

export function GivingBrandingSettings({
  logoUrl,
  primaryColor,
  accentColor,
}: GivingBrandingSettingsProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const [primary, setPrimary] = useState(primaryColor ?? "#1A2B4B");
  const [accent, setAccent] = useState(accentColor ?? "#C19A6B");

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);

    const formData = new FormData();
    formData.set("logo", file);
    startTransition(async () => {
      setMessage(null);
      const result = await uploadGivingLogo(formData);
      setMessage(result.error ?? "Logo updated.");
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
        setPrimary("#1A2B4B");
        setAccent("#C19A6B");
      }
      setMessage(result.error ?? "Colors reset to FaithForm defaults.");
    });
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <h4 className="text-sm font-medium">Donor page branding</h4>
        <p className="text-xs text-muted-foreground">
          Logo and colors appear on your public giving page for donors.
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
              className="h-14 w-auto max-w-[160px] rounded-md border border-border object-contain"
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
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleLogoChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => fileRef.current?.click()}
            >
              {preview ? "Replace logo" : "Upload logo"}
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, max 2MB</p>
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
              placeholder="#1A2B4B"
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
              placeholder="#C19A6B"
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
        <p className="text-xs text-muted-foreground">Preview</p>
        <div className="mt-2 flex gap-2">
          <span
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
            style={{ backgroundColor: primary }}
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
          Save colors
        </Button>
        <Button type="button" variant="outline" onClick={resetColors} disabled={pending}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
