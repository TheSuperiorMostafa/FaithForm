"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateChurchSlug } from "@/app/dashboard/settings/giving-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmAction } from "@/components/ui/confirm-dialog";

/**
 * The giving page's web address (the last part of the link). Changing it
 * breaks any link or QR code already printed, so that's said before saving.
 * Validation (letters, numbers and dashes, at least 3, not taken) stays on the
 * server in `updateChurchSlug`.
 */
export function WebAddressSettings({
  slug,
  givePageUrl,
}: {
  slug: string;
  givePageUrl: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(slug);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const base = givePageUrl.endsWith(slug) ? givePageUrl.slice(0, givePageUrl.length - slug.length) : "";
  const changed = value.trim() !== slug;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed) return;
    const ok = await confirmAction({
      title: "Change your giving page address?",
      description:
        "Links and QR codes you've already shared or printed will stop working. You'll need to share the new link.",
      confirmLabel: "Change address",
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateChurchSlug(value);
        if (result.error) {
          setError(result.error);
          return;
        }
        toast.success("Giving page address changed. Share the new link and QR code.");
        router.refresh();
      } catch {
        setError("We couldn't change the address. Please try again.");
      }
    });
  };

  return (
    <Card className="flex flex-col gap-6 p-6">
      <div className="space-y-1.5">
        <h2 className="font-heading text-xl font-bold text-foreground">Giving page address</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          The web address people visit to give. Use your church&apos;s name, with dashes instead of
          spaces.
        </p>
      </div>
      <form onSubmit={save} className="flex max-w-xl flex-col gap-3">
        <Label htmlFor={id}>Address</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id={id}
            value={value}
            maxLength={80}
            autoComplete="off"
            aria-describedby={`${id}-preview`}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={pending || !changed || !value.trim()}>
            Save address
          </Button>
        </div>
        <p id={`${id}-preview`} className="break-all text-[15px] text-muted-foreground">
          {base ? `${base}${value.trim() || slug}` : givePageUrl}
        </p>
        {error && (
          <p role="alert" className="text-[15px] font-medium text-destructive">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}
