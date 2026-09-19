"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Globe, Info, Mail } from "lucide-react";
import { toast } from "sonner";

import {
  setChurchFeature,
  setChurchFeatureEmails,
} from "@/app/admin/feature-actions";
import { DisableFeatureDialog } from "@/components/admin/disable-feature-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { FEATURE_KEYS, FEATURES, type FeatureKey } from "@/lib/features/catalog";
import type {
  FeatureEmailFlags,
  FeatureFlags,
  FeatureNotices,
} from "@/lib/features/access";
import {
  DISABLED_REASON_OPTIONS,
  type DisabledReason,
} from "@/lib/features/disabled-reason";
import { cn } from "@/lib/utils";

type ChurchFeaturesPanelProps = {
  churchId: string;
  churchName: string;
  flags: FeatureFlags;
  notices?: FeatureNotices;
  /** Each feature's Emails switch. Absent, or a missing key, reads as on. */
  emails?: Partial<FeatureEmailFlags>;
};

/**
 * Said beside a feature's Emails switch, for the email whose loss the church
 * would feel. A receipt is the donor's record of a gift for their taxes, and
 * turning it off looks exactly like the church forgetting to send one.
 */
const EMAIL_CAUTIONS: Partial<Record<FeatureKey, string>> = {
  giving:
    "Receipts are the church's tax acknowledgement to its donors. Only turn these off if the church sends its own.",
};

export function ChurchFeaturesPanel({
  churchId,
  churchName,
  flags: initialFlags,
  notices = {},
  emails: initialEmails = {},
}: ChurchFeaturesPanelProps) {
  const [flags, setFlags] = useState<FeatureFlags>(initialFlags);
  const [savingKey, setSavingKey] = useState<FeatureKey | null>(null);
  const [emails, setEmails] =
    useState<Partial<FeatureEmailFlags>>(initialEmails);
  const [savingEmailsKey, setSavingEmailsKey] = useState<FeatureKey | null>(
    null,
  );
  const [, startTransition] = useTransition();
  const router = useRouter();

  // The optimistic switch is a local guess. Once the server re-renders with the
  // saved flags, adopt them — otherwise a write that silently failed keeps
  // showing the state the operator wanted rather than the one that stuck.
  //
  // Keyed on the values, not the object: the server hands over a fresh object
  // every render, which would otherwise stomp an in-flight optimistic toggle.
  const flagsSignature = FEATURE_KEYS.map((key) =>
    initialFlags[key] ? "1" : "0",
  ).join("");

  useEffect(() => {
    setFlags(initialFlags);
    // initialFlags is re-created per render; flagsSignature is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flagsSignature]);

  // Same adoption rule for the Emails switches.
  const emailsSignature = FEATURE_KEYS.map((key) =>
    initialEmails[key] === false ? "0" : "1",
  ).join("");

  useEffect(() => {
    setEmails(initialEmails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailsSignature]);

  const enabledCount = FEATURES.filter((feature) => flags[feature.key]).length;

  // Switching off asks why first; switching on needs no explanation.
  const [disabling, setDisabling] = useState<FeatureKey | null>(null);

  const handleToggle = (
    key: FeatureKey,
    next: boolean,
    disabled?: { reason: DisabledReason; note: string | null },
  ) => {
    const previous = flags[key];
    // Optimistic — the switch should feel instant; we roll back on failure.
    setFlags((current) => ({ ...current, [key]: next }));
    setSavingKey(key);

    startTransition(async () => {
      const result = await setChurchFeature(churchId, key, next, disabled);
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

  const handleEmailsToggle = (key: FeatureKey, next: boolean) => {
    const previous = emails[key] !== false;
    setEmails((current) => ({ ...current, [key]: next }));
    setSavingEmailsKey(key);

    startTransition(async () => {
      const result = await setChurchFeatureEmails(churchId, key, next);
      setSavingEmailsKey(null);

      if (!result.ok) {
        setEmails((current) => ({ ...current, [key]: previous }));
        toast.error(result.error);
        return;
      }

      const label = FEATURES.find((f) => f.key === key)?.label ?? key;
      toast.success(
        `${label} emails turned ${next ? "on" : "off"} for ${churchName}.`,
      );
      router.refresh();
    });
  };

  const disablingFeature = disabling
    ? (FEATURES.find((f) => f.key === disabling) ?? null)
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Features</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Turn product areas on or off for this account. Disabling one removes
            it from the church&apos;s navigation, blocks its pages and API
            routes for admins and members alike, and — where the feature has one
            — takes its public surface down too. Features that send email have
            their own Emails switch, which stops just the email.
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
          const emailsOn = emails[feature.key] !== false;
          const emailCaution = EMAIL_CAUTIONS[feature.key];
          const reasonLabel = enabled
            ? null
            : (DISABLED_REASON_OPTIONS.find(
                (option) => option.value === notices[feature.key]?.reason,
              )?.label ?? null);

          return (
            <div
              key={feature.key}
              className={cn(
                "rounded-xl border p-4 transition-colors",
                enabled
                  ? "border-border bg-background"
                  : "border-dashed border-border bg-muted/30",
              )}
            >
              <div className="flex items-start justify-between gap-4">
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
                    {!enabled && reasonLabel ? (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        <Info className="size-3 shrink-0" strokeWidth={2} aria-hidden />
                        {reasonLabel}
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
                  onCheckedChange={(next) => {
                    if (next) {
                      handleToggle(feature.key, true);
                      return;
                    }
                    setDisabling(feature.key);
                  }}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${feature.label} for ${churchName}`}
                />
              </div>

              {/* Independent of the feature switch: a switched-off Giving still
                  runs existing recurring gifts, and those still send receipts. */}
              {feature.emails ? (
                <div className="mt-3 flex items-start justify-between gap-4 border-t border-border pt-3 sm:pl-12">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Mail
                        className="size-3.5 shrink-0"
                        strokeWidth={2}
                        aria-hidden
                      />
                      Emails
                      {!emailsOn ? (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                          Off
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                      {feature.emails}
                    </p>
                    {emailCaution ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-300">
                        <AlertTriangle
                          className="mt-0.5 size-3 shrink-0"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <span>{emailCaution}</span>
                      </p>
                    ) : null}
                  </div>

                  <Switch
                    checked={emailsOn}
                    disabled={savingEmailsKey === feature.key}
                    onCheckedChange={(next) =>
                      handleEmailsToggle(feature.key, next)
                    }
                    aria-label={`Turn ${feature.label} emails ${emailsOn ? "off" : "on"} for ${churchName}`}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      {disablingFeature && (
        <DisableFeatureDialog
          key={disablingFeature.key}
          featureLabel={disablingFeature.label}
          churchName={churchName}
          open
          onOpenChange={(next) => {
            if (!next) setDisabling(null);
          }}
          onConfirm={(reason, note) => {
            setDisabling(null);
            handleToggle(disablingFeature.key, false, { reason, note });
          }}
        />
      )}
    </Card>
  );
}
