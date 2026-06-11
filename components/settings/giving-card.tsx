"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Heart, ExternalLink, Copy, Check } from "lucide-react";
import {
  syncStripeAccountStatus,
  updateChurchSlug,
} from "@/app/dashboard/settings/giving-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GivingBrandingSettings } from "@/components/giving/giving-branding-settings";
import { FundsSettings } from "@/components/giving/funds-settings";
import { StatementSettings } from "@/components/giving/statement-settings";
import { STRIPE_NONPROFIT_RATE_LABEL } from "@/lib/stripe/config";
import type { ChurchGivingProfile, GivingFundRow } from "@/types/giving";

function statusBadge(status: ChurchGivingProfile["stripeOnboardingStatus"]) {
  switch (status) {
    case "active":
      return <Badge variant="default">Live — accepting gifts</Badge>;
    case "restricted":
      return <Badge variant="destructive">Action required</Badge>;
    case "pending":
      return <Badge variant="secondary">Verification in progress</Badge>;
    case "deauthorized":
      return <Badge variant="destructive">Disconnected</Badge>;
    default:
      return <Badge variant="outline">Not connected</Badge>;
  }
}

export function GivingCard({
  isAdmin,
  profile,
  funds = [],
}: {
  isAdmin: boolean;
  profile: ChurchGivingProfile;
  funds?: GivingFundRow[];
}) {
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [slug, setSlug] = useState(profile.slug);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (searchParams.get("stripe_return")) {
      setMessage("Returned from Stripe. Syncing account status…");
      startTransition(async () => {
        await syncStripeAccountStatus();
      });
    } else if (searchParams.get("stripe_refresh")) {
      setMessage("Continue setup in Stripe to finish connecting.");
    }
  }, [searchParams]);

  const startOnboard = () => {
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/stripe/connect/onboard", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not start Stripe onboarding.");
        return;
      }
      window.location.href = data.url;
    });
  };

  const refreshOnboard = () => {
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/stripe/connect/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Could not refresh Stripe link.");
        return;
      }
      window.location.href = data.url;
    });
  };

  const saveSlug = () => {
    startTransition(async () => {
      const result = await updateChurchSlug(slug);
      setMessage(result.error ?? "Giving page URL updated.");
    });
  };

  const copyGiveLink = async () => {
    await navigator.clipboard.writeText(profile.givePageUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-accent" />
            Giving
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask a church admin to connect Stripe for online giving.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-accent" />
          Giving &amp; Stripe
        </CardTitle>
        <CardDescription>
          Accept one-time and recurring gifts. FaithForm charges no platform fee —
          donors pay {STRIPE_NONPROFIT_RATE_LABEL} only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(profile.stripeOnboardingStatus)}
              {profile.stripeChargesEnabled && profile.stripePayoutsEnabled && (
                <span className="text-xs text-muted-foreground">Payouts enabled</span>
              )}
            </div>

            {profile.stripeRequirementsDue.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="font-medium">Stripe needs more information:</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {profile.stripeRequirementsDue.map((item) => (
                    <li key={item}>{item.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            )}

            {message && (
              <p className="text-sm text-muted-foreground" role="status">
                {message}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {!profile.stripeAccountId ? (
                <Button onClick={startOnboard} disabled={pending}>
                  Connect with Stripe
                </Button>
              ) : profile.stripeOnboardingStatus !== "active" ? (
                <Button onClick={refreshOnboard} disabled={pending}>
                  Continue Stripe setup
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    startTransition(async () => {
                      await syncStripeAccountStatus();
                      setMessage("Account status refreshed.");
                    });
                  }}
                  disabled={pending}
                >
                  Refresh status
                </Button>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border p-4">
              <Label htmlFor="giving-slug">Public giving page URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="giving-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  disabled={!profile.stripeChargesEnabled && pending}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={saveSlug}
                  disabled={pending}
                >
                  Save slug
                </Button>
              </div>
              <p className="text-xs text-muted-foreground break-all">
                {profile.givePageUrl}
              </p>
              {profile.stripeChargesEnabled && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={copyGiveLink}
                  >
                    {copied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Copy give link
                  </Button>
                  <a
                    href={profile.givePageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:border-accent"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Preview
                  </a>
                </div>
              )}
            </div>
          </div>

          <GivingBrandingSettings
            logoUrl={profile.logoUrl}
            primaryColor={profile.givingPrimaryColor}
            accentColor={profile.givingAccentColor}
            className="border-t-0 pt-0 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0"
          />
        </div>

        {profile.stripeChargesEnabled && (
          <div className="grid gap-4 border-t pt-4 lg:grid-cols-2">
            <FundsSettings funds={funds.filter((f) => f.isActive)} className="border-t-0 pt-0" />
            <StatementSettings
              ein={profile.ein ?? null}
              statementAddress={profile.statementAddress ?? null}
              className="border-t-0 pt-0 lg:border-l lg:pl-4"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
