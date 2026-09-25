"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { updateGivingBranding } from "@/app/dashboard/settings/giving-actions";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** FaithForm's own navy and gold, used when a church hasn't chosen. */
export const DEFAULT_BRAND = { primary: "#002D5F", accent: "#C5A059" };

/**
 * A handful of tried pairs, so choosing colours is a tap rather than a hex
 * code. The app adjusts either colour further if it needs more contrast.
 */
export const BRAND_SWATCHES: ReadonlyArray<{ name: string; primary: string; accent: string }> = [
  { name: "Navy and gold", primary: DEFAULT_BRAND.primary, accent: DEFAULT_BRAND.accent },
  { name: "Forest and wheat", primary: "#1F4D3A", accent: "#C9A227" },
  { name: "Burgundy and sand", primary: "#6B1E2E", accent: "#D4A373" },
  { name: "Royal and sky", primary: "#1E3A8A", accent: "#60A5FA" },
  { name: "Plum and honey", primary: "#4A2C6D", accent: "#E0B34C" },
  { name: "Charcoal and coral", primary: "#2B2D42", accent: "#EF8354" },
];

const up = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();

export function BrandColorsCard({
  primaryColor,
  accentColor,
}: {
  primaryColor: string | null;
  accentColor: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState({
    primary: up(primaryColor) || DEFAULT_BRAND.primary,
    accent: up(accentColor) || DEFAULT_BRAND.accent,
  });
  const [custom, setCustom] = useState(current);
  const [error, setError] = useState<string | null>(null);

  const matching = BRAND_SWATCHES.find(
    (swatch) => swatch.primary === current.primary && swatch.accent === current.accent,
  );

  const apply = (next: { primary: string; accent: string }, name: string) => {
    setError(null);
    const isDefault = next.primary === DEFAULT_BRAND.primary && next.accent === DEFAULT_BRAND.accent;
    startTransition(async () => {
      try {
        // Saving FaithForm's own pair clears the choice, which is what
        // "Reset to defaults" used to do.
        const result = await updateGivingBranding(
          isDefault
            ? { primaryColor: null, accentColor: null }
            : { primaryColor: next.primary, accentColor: next.accent },
        );
        if (result.error) {
          setError("We couldn't change your colours. Please try again.");
          return;
        }
        setCurrent(next);
        setCustom(next);
        toast.success(`App colours changed to ${name}.`);
        router.refresh();
      } catch {
        setError("We couldn't change your colours. Please try again.");
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>App colours</CardTitle>
        <CardDescription className="text-[15px]">
          Used across your church&apos;s app and giving page. Tap a pair to use it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div role="radiogroup" aria-label="App colours" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BRAND_SWATCHES.map((swatch) => {
            const active = matching?.name === swatch.name;
            return (
              <button
                key={swatch.name}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={pending}
                onClick={() => apply({ primary: swatch.primary, accent: swatch.accent }, swatch.name.toLowerCase())}
                className={cn(
                  "flex min-h-16 items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60",
                  active ? "border-accent bg-accent/10" : "border-border bg-background hover:border-accent/50",
                )}
              >
                <span aria-hidden className="flex shrink-0 -space-x-2">
                  <span className="size-9 rounded-full border-2 border-background" style={{ backgroundColor: swatch.primary }} />
                  <span className="size-9 rounded-full border-2 border-background" style={{ backgroundColor: swatch.accent }} />
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">{swatch.name}</span>
                {active && <Check className="size-5 text-accent" strokeWidth={2.5} aria-hidden />}
              </button>
            );
          })}
        </div>

        {!matching && (
          <p className="text-[15px] text-muted-foreground">You&apos;re using your own colours.</p>
        )}

        <AdvancedSection title="Custom colour" description="Match your church's own colours exactly.">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <input
                id="brand-primary"
                type="color"
                value={custom.primary}
                onChange={(event) => setCustom((c) => ({ ...c, primary: event.target.value.toUpperCase() }))}
                className="h-12 w-16 cursor-pointer rounded-xl border border-border bg-background"
              />
              <Label htmlFor="brand-primary" className="text-[15px]">
                Main colour
                <span className="block text-sm font-normal text-muted-foreground">Headings and buttons</span>
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="brand-accent"
                type="color"
                value={custom.accent}
                onChange={(event) => setCustom((c) => ({ ...c, accent: event.target.value.toUpperCase() }))}
                className="h-12 w-16 cursor-pointer rounded-xl border border-border bg-background"
              />
              <Label htmlFor="brand-accent" className="text-[15px]">
                Highlight colour
                <span className="block text-sm font-normal text-muted-foreground">Selected items and accents</span>
              </Label>
            </div>
          </div>
          <div
            className="flex flex-wrap items-center gap-2 rounded-2xl border p-4"
            style={{ borderColor: `${custom.accent}66`, backgroundColor: `${custom.primary}10` }}
          >
            <span className="text-sm text-muted-foreground">Preview:</span>
            <span className="rounded-lg px-3 py-1.5 text-sm font-semibold" style={{ backgroundColor: custom.accent, color: custom.primary }}>
              Selected
            </span>
            <span className="rounded-lg border px-3 py-1.5 text-sm font-semibold" style={{ borderColor: custom.primary, color: custom.primary }}>
              Not selected
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending || (custom.primary === current.primary && custom.accent === current.accent)}
            onClick={() => apply(custom, "your own colours")}
          >
            {pending ? "Saving…" : "Use these colours"}
          </Button>
        </AdvancedSection>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
