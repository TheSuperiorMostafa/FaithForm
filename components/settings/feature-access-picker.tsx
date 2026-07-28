"use client";

import { Check, Lock } from "lucide-react";

import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";

type FeatureAccessPickerProps = {
  /** Features the account has switched on — the only ones grantable. */
  availableFeatures: FeatureKey[];
  selected: FeatureKey[];
  onChange: (next: FeatureKey[]) => void;
  disabled?: boolean;
  /** Name used for the hidden inputs that carry the selection into the form. */
  name?: string;
};

export function FeatureAccessPicker({
  availableFeatures,
  selected,
  onChange,
  disabled = false,
  name = "features",
}: FeatureAccessPickerProps) {
  const options = FEATURES.filter((feature) =>
    availableFeatures.includes(feature.key),
  );

  const toggle = (key: FeatureKey) => {
    onChange(
      selected.includes(key)
        ? selected.filter((value) => value !== key)
        : [...selected, key],
    );
  };

  const allSelected =
    options.length > 0 && options.every((f) => selected.includes(f.key));

  if (options.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No features are enabled for your account yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      {selected.map((key) => (
        <input key={key} type="hidden" name={name} value={key} />
      ))}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Feature access
        </p>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onChange(allSelected ? [] : options.map((f) => f.key))
          }
          className="text-xs font-semibold text-accent transition-colors hover:text-brand-lightGold disabled:opacity-50"
        >
          {allSelected ? "Clear all" : "Select all"}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((feature) => {
          const active = selected.includes(feature.key);
          const Icon = feature.icon;

          return (
            <button
              key={feature.key}
              type="button"
              role="checkbox"
              aria-checked={active}
              disabled={disabled}
              onClick={() => toggle(feature.key)}
              className={cn(
                "group flex items-start gap-3 rounded-xl border p-3 text-left transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-accent/60 bg-accent/10 shadow-sm"
                  : "border-border bg-background hover:border-accent/40 hover:bg-accent/5",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground group-hover:text-accent",
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">
                    {feature.label}
                  </span>
                  {active && (
                    <Check
                      className="size-3.5 text-accent"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {feature.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AdminAccessNotice() {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
      <span>
        Admins get every feature your account has enabled, plus billing,
        integrations, and team management.
      </span>
    </p>
  );
}
