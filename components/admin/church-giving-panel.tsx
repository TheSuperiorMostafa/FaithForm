"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  openStripeDashboardForChurch,
  setChurchApplePayDonationsApproval,
  updateAdminChurchSlug,
} from "@/app/admin/giving-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AdminChurchDetail } from "@/lib/queries/admin";

function givingBadge(status: string, chargesEnabled: boolean) {
  if (chargesEnabled) {
    return <Badge>Live</Badge>;
  }
  if (status === "restricted") {
    return <Badge variant="destructive">Restricted</Badge>;
  }
  if (status === "deauthorized") {
    return <Badge variant="destructive">Deauthorized</Badge>;
  }
  if (status === "pending") {
    return <Badge variant="secondary">Pending</Badge>;
  }
  return <Badge variant="outline">Not started</Badge>;
}

export function ChurchGivingPanel({ detail }: { detail: AdminChurchDetail }) {
  const { giving, church } = detail;
  const [slug, setSlug] = useState(church.slug);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Stripe Connect
            {givingBadge(giving.stripeOnboardingStatus, giving.stripeChargesEnabled)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <DetailRow label="Account ID" value={giving.stripeAccountId ?? "—"} />
          <DetailRow
            label="Charges enabled"
            value={giving.stripeChargesEnabled ? "Yes" : "No"}
          />
          <DetailRow
            label="Payouts enabled"
            value={giving.stripePayoutsEnabled ? "Yes" : "No"}
          />
          <DetailRow
            label="Giving enabled"
            value={
              giving.givingEnabledAt
                ? new Date(giving.givingEnabledAt).toLocaleString()
                : "—"
            }
          />
          {giving.stripeRequirementsDue.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Requirements due</p>
              <ul className="mt-1 list-inside list-disc text-muted-foreground">
                {giving.stripeRequirementsDue.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {giving.stripeAccountId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={pending}
              onClick={() => {
                startTransition(async () => {
                  const result = await openStripeDashboardForChurch(church.id);
                  if (result.error) {
                    setMessage(result.error);
                    return;
                  }
                  if (result.url) window.open(result.url, "_blank");
                });
              }}
            >
              <ExternalLink className="h-4 w-4" />
              Open Stripe Dashboard
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Public give page</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground break-all">{giving.givePageUrl}</p>
          <div className="space-y-2">
            <Label htmlFor="admin-slug">Slug</Label>
            <div className="flex gap-2">
              <Input
                id="admin-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await updateAdminChurchSlug(church.id, slug);
                    setMessage(result.error ?? "Slug updated.");
                  });
                }}
              >
                Save
              </Button>
            </div>
          </div>
          {message && (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      <ApplePayDonationsCard
        churchId={church.id}
        churchName={church.name}
        approval={giving.applePayDonations}
      />
    </div>
  );
}

/**
 * The per-church gate for taking gifts with Apple Pay inside the iPhone app.
 *
 * Apple permits it only for a nonprofit Apple has approved, which in the US
 * means a Candid Seal of Transparency; everyone else is sent to the web give
 * page in Safari. Turning this on is us saying we looked the Seal up, so it
 * lives here and never on the church's own settings screen.
 */
function ApplePayDonationsCard({
  churchId,
  churchName,
  approval,
}: {
  churchId: string;
  churchName: string;
  approval: AdminChurchDetail["giving"]["applePayDonations"];
}) {
  const router = useRouter();
  const [approved, setApproved] = useState(approval?.approved ?? false);
  const [approvedAt, setApprovedAt] = useState(approval?.approvedAt ?? null);
  const [saving, startSaving] = useTransition();

  // Adopt what the server re-rendered with, so a write that did not stick
  // cannot keep showing the state the operator wanted. Keyed on the values:
  // the object itself is new on every render.
  useEffect(() => {
    setApproved(approval?.approved ?? false);
    setApprovedAt(approval?.approvedAt ?? null);
  }, [approval?.approved, approval?.approvedAt]);

  // A database without 0072 has nowhere to save the switch, so it is shown
  // disabled with the reason rather than flipping and failing.
  const migrationMissing = approval === null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          In-app giving on iPhone
          {approved ? (
            <Badge>Apple Pay</Badge>
          ) : (
            <Badge variant="outline">Web link</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              Candid Seal verified — allow in-app Apple Pay giving on iPhone
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Apple only allows in-app donations to nonprofits it has approved;
              until this is on, the iPhone app opens this church&apos;s give
              page in Safari instead.
            </p>
          </div>
          <Switch
            checked={approved}
            disabled={saving || migrationMissing}
            aria-label={`${approved ? "Withdraw" : "Allow"} in-app Apple Pay giving for ${churchName}`}
            onCheckedChange={(next) => {
              const previous = { approved, approvedAt };
              // Optimistic, and rolled back if the write is refused.
              setApproved(next);
              startSaving(async () => {
                const result = await setChurchApplePayDonationsApproval(
                  churchId,
                  next,
                );
                if (result.error) {
                  setApproved(previous.approved);
                  setApprovedAt(previous.approvedAt);
                  toast.error(result.error);
                  return;
                }
                setApprovedAt(result.approvedAt ?? null);
                toast.success(
                  next
                    ? `In-app Apple Pay giving allowed for ${churchName}.`
                    : `${churchName} is back to the web give link on iPhone.`,
                );
                router.refresh();
              });
            }}
          />
        </div>
        {migrationMissing ? (
          <p className="text-xs text-muted-foreground">
            Unavailable until migration 0072 is applied to this database.
          </p>
        ) : approved && approvedAt ? (
          <p className="text-xs text-muted-foreground">
            Verified {new Date(approvedAt).toLocaleString()}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
