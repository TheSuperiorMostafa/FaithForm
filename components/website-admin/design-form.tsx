"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { saveDesign } from "@/app/dashboard/website/actions";
import { SaveStatus } from "@/components/website-admin/save-status";
import { useAutosave } from "@/components/website-admin/use-autosave";
import { ColorPickerField } from "@/components/ui/color-picker-field";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SiteThemeOption } from "@/lib/sites/queries";
import { undoToast } from "@/lib/ui/undo-toast";
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

export type DesignFormProps = {
  themes: SiteThemeOption[];
  initialThemeKey: string;
  initialTokens: Record<string, string>;
  initialCustomCss: string;
  /** The active theme's own token values, shown as the placeholder. */
  themeDefaults: Record<string, string>;
  isPlatformAdmin: boolean;
};

/**
 * Theme and colours, shown as the "Look" part of Website → Look & Details.
 *
 * Autosaves like the rest of the editor. Because a live site changes the
 * moment this saves, switching theme on a live site asks first and then offers
 * Undo, which puts the previous theme back.
 */
export function DesignForm({
  themes,
  initialThemeKey,
  initialTokens,
  initialCustomCss,
  themeDefaults,
  canEdit,
  isPlatformAdmin,
  isLive,
  onSaved,
}: DesignFormProps & {
  canEdit: boolean;
  isLive: boolean;
  /** Fired after a successful save, so a preview beside it can reload. */
  onSaved?: () => void;
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

  const { status } = useAutosave(
    design,
    async (value) => {
      const result = await saveDesign(value);
      if (result.ok) onSaved?.();
      return result;
    },
    { enabled: canEdit },
  );

  const nameOf = (key: string) => themes.find((t) => t.key === key)?.name ?? "that";

  async function chooseTheme(next: string) {
    if (next === themeKey) return;
    const previous = themeKey;

    if (isLive) {
      const ok = await confirmAction({
        title: `Switch to the ${nameOf(next)} look?`,
        description:
          "Your live website changes now, for everyone who visits. You can switch back straight after.",
        confirmLabel: `Use ${nameOf(next)}`,
      });
      if (!ok) return;
    }

    setThemeKey(next);
    undoToast(
      `Your website now uses the ${nameOf(next)} look.`,
      () => {
        setThemeKey(previous);
      },
      { undoneMessage: `Back to the ${nameOf(previous)} look.` },
    );
  }

  return (
    <div id="look" className="flex scroll-mt-6 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold">Look</h2>
          <p className="text-[15px] text-muted-foreground">
            The style and colours of your whole website.
          </p>
        </div>
        {canEdit ? <SaveStatus status={status} /> : null}
      </div>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h3 className="font-heading text-lg font-bold">Style</h3>
        <p className="text-[15px] text-muted-foreground">
          The overall shape of your site: lettering, spacing, and how sections are laid out.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {themes.map((theme) => {
            const selected = themeKey === theme.key;
            return (
              <button
                key={theme.key}
                type="button"
                disabled={!canEdit}
                onClick={() => void chooseTheme(theme.key)}
                aria-pressed={selected}
                className={cn(
                  "flex min-h-11 flex-col rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                  selected
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/50",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-heading text-base font-bold">{theme.name}</span>
                  {selected ? (
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
                      <Check className="size-4" aria-hidden /> In use
                    </span>
                  ) : null}
                </span>
                {theme.description ? (
                  <span className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {theme.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h3 className="font-heading text-lg font-bold">Your colours</h3>
        <p className="text-[15px] text-muted-foreground">
          Leave a colour blank to use the style&apos;s own.
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
              <p className="text-sm text-muted-foreground">{token.help}</p>
            </div>
          ))}
        </div>
      </section>

      {isPlatformAdmin ? (
        <section className="rounded-2xl border border-dashed border-border bg-card p-6 shadow-card">
          <h3 className="font-heading text-lg font-bold">Custom CSS</h3>
          <p className="text-[15px] text-muted-foreground">
            Platform admins only. For one-offs this church&apos;s site needs and the
            structured options cannot express. Only loads on their pages.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="custom-css" className="sr-only">
              Custom CSS
            </Label>
            <Textarea
              id="custom-css"
              rows={8}
              className="font-mono text-sm"
              value={customCss}
              onChange={(e) => setCustomCss(e.target.value)}
              placeholder=".site-hero { … }"
            />
          </div>
        </section>
      ) : null}

      {!canEdit ? (
        <p className="text-sm text-muted-foreground">
          Only church admins can change the look.
        </p>
      ) : null}
    </div>
  );
}
