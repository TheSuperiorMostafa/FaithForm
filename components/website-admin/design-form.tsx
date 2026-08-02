"use client";

import { useMemo, useState } from "react";

import { saveDesign } from "@/app/dashboard/website/actions";
import { SaveStatus } from "@/components/website-admin/save-status";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { ColorPickerField } from "@/components/ui/color-picker-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SiteThemeOption } from "@/lib/sites/queries";
import { cn } from "@/lib/utils";

/**
 * Brand tokens a church may set. Deliberately a short list: these are the
 * values that make a site feel like theirs, while spacing, type scale and
 * radii stay with the theme so a church cannot accidentally dismantle the
 * design it is paying for.
 */
const BRAND_TOKENS = [
  {
    key: "--site-ink",
    label: "Main dark colour",
    help: "Headers, dark sections, and the footer.",
  },
  {
    key: "--site-accent",
    label: "Accent colour",
    help: "Buttons, highlights, and the small uppercase labels.",
  },
  {
    key: "--site-canvas",
    label: "Page background",
    help: "The light background behind most sections.",
  },
  {
    key: "--site-gold",
    label: "Secondary accent",
    help: "The italic serif words inside headlines.",
  },
] as const;

export function DesignForm({
  themes,
  initialThemeKey,
  initialTokens,
  initialCustomCss,
  themeDefaults,
  canEdit,
  isPlatformAdmin,
}: {
  themes: SiteThemeOption[];
  initialThemeKey: string;
  initialTokens: Record<string, string>;
  initialCustomCss: string;
  /** The active theme's own token values, shown as the placeholder. */
  themeDefaults: Record<string, string>;
  canEdit: boolean;
  isPlatformAdmin: boolean;
}) {
  const [themeKey, setThemeKey] = useState(initialThemeKey);
  const [tokens, setTokens] = useState<Record<string, string>>(initialTokens);
  const [customCss, setCustomCss] = useState(initialCustomCss);

  // One value for the whole panel, so a colour and a theme change a moment
  // apart collapse into a single write instead of racing each other.
  const design = useMemo(
    () => ({
      themeKey,
      // Empty means "inherit from the theme", so it must not be stored.
      brandTokens: Object.fromEntries(
        Object.entries(tokens).filter(([, v]) => v.trim()),
      ),
      customCss,
    }),
    [themeKey, tokens, customCss],
  );

  const { status } = useAutosave(design, saveDesign, { enabled: canEdit });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Changes save on their own.
        </p>
        <SaveStatus status={status} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-heading text-lg font-bold">Theme</h2>
        <p className="text-sm text-muted-foreground">
          The overall shape of your site — type, spacing, and section layout.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {themes.map((theme) => (
            <button
              key={theme.key}
              type="button"
              disabled={!canEdit}
              onClick={() => setThemeKey(theme.key)}
              aria-pressed={themeKey === theme.key}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                themeKey === theme.key
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-accent/50",
              )}
            >
              <div className="font-heading text-base font-bold">{theme.name}</div>
              {theme.description ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {theme.description}
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-heading text-lg font-bold">Your colours</h2>
        <p className="text-sm text-muted-foreground">
          Leave a colour blank to use the theme&apos;s own.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {BRAND_TOKENS.map((token) => (
            <div key={token.key} className="flex flex-col gap-1.5">
              <ColorPickerField
                id={`token-${token.key}`}
                label={token.label}
                value={tokens[token.key] ?? ""}
                // Unset falls back to the live theme value, so the swatch shows
                // what the site actually renders rather than an arbitrary black.
                defaultColor={themeDefaults[token.key] ?? "#000000"}
                onChange={(value) =>
                  setTokens((current) => ({ ...current, [token.key]: value }))
                }
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">{token.help}</p>
            </div>
          ))}
        </div>
      </section>

      {isPlatformAdmin ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-5 shadow-card">
          <h2 className="font-heading text-lg font-bold">Custom CSS</h2>
          <p className="text-sm text-muted-foreground">
            Escape hatch for one-offs this church&apos;s site needs and the
            structured options cannot express. Only loads on their pages.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="custom-css" className="sr-only">
              Custom CSS
            </Label>
            <Textarea
              id="custom-css"
              rows={8}
              className="font-mono text-xs"
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              placeholder=".site-hero { … }"
            />
          </div>
        </section>
      ) : null}

      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Only church admins can change the design.
        </p>
      ) : (
        <SaveStatus status={status} />
      )}
    </div>
  );
}
