"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { Area } from "react-easy-crop";
import type { ProfileData } from "@/components/onboarding/OnboardingWizard";
import { ImageCropper } from "@/components/website-admin/image-cropper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { downscaleForUpload, UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { cn } from "@/lib/utils";

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
];

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px]",
  "focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

type StepProfileProps = {
  profile: ProfileData;
  onChange: (profile: ProfileData) => void;
  error: string | null;
  pending: boolean;
  onUpload: (file: File, crop: Area) => Promise<string | null>;
  onNext: () => void;
  onSkip: () => void;
};

export function StepProfile({
  profile,
  onChange,
  error,
  pending,
  onUpload,
  onNext,
  onSkip,
}: StepProfileProps) {
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(profile.logoUrl || null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * The logo is framed in the same square cropper the group photo uses. The
   * shrink comes first because the cropper reports source-image pixels, which
   * must describe the file that is actually uploaded.
   */
  async function handleFile(file: File) {
    setPickError(null);
    if (!file.type.startsWith("image/")) {
      setPickError("That file isn't an image.");
      return;
    }
    setPreparing(true);
    let ready: File;
    try {
      ready = await downscaleForUpload(file);
    } finally {
      setPreparing(false);
    }
    if (ready.size > UPLOAD_BUDGET_BYTES) {
      setPickError("That photo is too large to upload. Save it as a JPG and try again.");
      return;
    }
    setCropping(ready);
  }

  async function upload(file: File, crop: Area) {
    setUploading(true);
    const url = await onUpload(file, crop);
    setUploading(false);
    if (url) {
      setPreview(url);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-heading text-2xl font-semibold text-foreground">
          Tell us about your church
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          Only the name is needed now. Everything else can wait, and you can
          change it any time in Settings → Church info.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="churchName">Church name</Label>
        <Input
          id="churchName"
          value={profile.name}
          onChange={(e) => onChange({ ...profile, name: e.target.value })}
          required
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Street address (optional)</Label>
        <Input
          id="address"
          value={profile.address}
          onChange={(e) => onChange({ ...profile, address: e.target.value })}
          className={inputClass}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-1">
          <Label htmlFor="city">City</Label>
          <Input
            id="city"
            value={profile.city}
            onChange={(e) => onChange({ ...profile, city: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="state">State</Label>
          <Select
            id="state"
            value={profile.state}
            onChange={(e) => onChange({ ...profile, state: e.target.value })}
            className={inputClass}
          >
            <option value="">Select</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="zip">ZIP code</Label>
          <Input
            id="zip"
            value={profile.zip}
            onChange={(e) => onChange({ ...profile, zip: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="website">Website URL (optional)</Label>
          <Input
            id="website"
            type="url"
            value={profile.website}
            onChange={(e) => onChange({ ...profile, website: e.target.value })}
            placeholder="https://"
            className={inputClass}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone (optional)</Label>
          <Input
            id="phone"
            type="tel"
            value={profile.phone}
            onChange={(e) => onChange({ ...profile, phone: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Logo (optional)</Label>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Choose a logo picture"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "bg-muted/30 px-4 py-8 transition-colors hover:border-accent/50 hover:bg-accent/5",
          )}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Logo preview"
              className="mb-2 size-24 rounded-lg object-cover"
            />
          ) : (
            <Upload className="mb-2 size-8 text-muted-foreground" strokeWidth={1.5} />
          )}
          <p className="text-base text-muted-foreground">
            {uploading
              ? "Uploading…"
              : preparing
                ? "Preparing photo…"
                : "Choose a picture, or drag one here. You'll frame it as a square."}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so choosing the same file again still opens the cropper.
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
        </div>
        {pickError && (
          <p className="text-sm text-destructive" role="alert">
            {pickError}
          </p>
        )}
      </div>

      {cropping && (
        <ImageCropper
          file={cropping}
          aspectKey="logo"
          onCancel={() => setCropping(null)}
          onConfirm={(crop) => {
            const file = cropping;
            setCropping(null);
            void upload(file, crop);
          }}
        />
      )}

      {error && (
        <p className="text-base text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onSkip} disabled={pending}>
          Skip for now
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={onNext}
          disabled={pending || uploading || preparing}
          className="h-12 w-full sm:w-auto"
        >
          {pending ? "Saving…" : "Save and continue"}
        </Button>
      </div>
    </div>
  );
}
