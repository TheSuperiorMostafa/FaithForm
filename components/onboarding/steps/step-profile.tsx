"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { ProfileData } from "@/components/onboarding/OnboardingWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
  onUpload: (file: File) => Promise<string | null>;
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
  const [preview, setPreview] = useState<string | null>(profile.logoUrl || null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    const url = await onUpload(file);
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
          Tell Us About Your Church
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This helps personalize your experience.
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
        <Label htmlFor="address">Street address</Label>
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
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border",
            "bg-muted/30 px-4 py-8 transition-colors hover:border-accent/50 hover:bg-accent/5",
          )}
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Logo preview"
              className="mb-2 max-h-24 max-w-full rounded-lg object-contain"
            />
          ) : (
            <Upload className="mb-2 size-8 text-muted-foreground" strokeWidth={1.5} />
          )}
          <p className="text-sm text-muted-foreground">
            {uploading ? "Uploading…" : "Drag & drop or click to upload (PNG/JPG, max 2MB)"}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          disabled={pending}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Skip for now
        </button>
        <Button type="button" onClick={onNext} disabled={pending || uploading} className="w-full sm:w-auto">
          {pending ? "Saving…" : "Continue →"}
        </Button>
      </div>
    </div>
  );
}
