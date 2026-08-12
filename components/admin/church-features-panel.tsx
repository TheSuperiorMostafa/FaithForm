"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { toast } from "sonner";

import { setChurchFeature } from "@/app/admin/feature-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FEATURES, type FeatureKey } from "@/lib/features/catalog";
import type { FeatureFlags } from "@/lib/features/access";
import { cn } from "@/lib/utils";

type ChurchFeaturesPanelProps = {
  churchId: string;
  churchName: string;
  flags: FeatureFlags;
};

export function ChurchFeaturesPanel({
  churchId,
  churchName,
  flags: initialFlags,
}: ChurchFeaturesPanelProps) {
  const [flags, setFlags] = useState<FeatureFlags>(initialFlags);
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const enabledCount = FEATURES.filter((feature) => flags[feature.key]).length;

  const handleToggle = (key: FeatureKey, next: boolean) => {
    const previous = flags[key];
    // Optimistic — the switch should feel instant; we roll back on failure.
    setFlags((current) => ({ ...current, [key]: next }));
    setSavingKey(key);

    startTransition(async () => {
      const result = await setChurchFeature(churchId, key, next);
      setSavingKey(null);

      if (!result.ok) {
        setFlags((current) => ({ ...current, [key]: previous }));
        toast.error(result.error);
        return;
      }

      const label = FEATURES.find((f) => f.key === key)?.label ?? key;
      toast.success(
        `${label} ${next ? "enabled" : "disabled"} for ${churchName}.`,
      );
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Features</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn product areas on or off for this account. Disabling one removes
            it from the church&apos;s navigation, blocks its pages and API
            routes for admins and members alike, and — where the feature has one
            — takes its public surface down too.
          </p>
        </div>
        <Badge variant={enabledCount === FEATURES.length ? "success" : "info"}>
          {enabledCount} of {FEATURES.length} on
        </Badge>
      </CardHeader>

      <CardContent className="grid gap-2.5 lg:grid-cols-2">
        {FEATURES.map((feature) => {
          const enabled = flags[feature.key];
          const Icon = feature.icon;
          const saving = savingKey === feature.key;

          return (
            <div
              key={feature.key}
              className={cn(
                "flex items-start justify-between gap-4 rounded-xl border p-4 transition-colors",
                enabled
                  ? "border-border bg-background"
                  : "border-dashed border-border bg-muted/30",
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                    enabled
                      ? "bg-accent/10 text-accent"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      enabled ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {feature.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {feature.description}
                  </p>
                  {feature.publicImpact ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-300">
                      <Globe
                        className="mt-0.5 size-3 shrink-0"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>{feature.publicImpact}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                    {feature.routes.join(" · ")}
                  </p>
                </div>
              </div>

              <Switch
                checked={enabled}
                disabled={saving}
                onCheckedChange={(next) => handleToggle(feature.key, next)}
                aria-label={`${enabled ? "Disable" : "Enable"} ${feature.label} for ${churchName}`}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
