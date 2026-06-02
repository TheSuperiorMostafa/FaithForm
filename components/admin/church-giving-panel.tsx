"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import {
  openStripeDashboardForChurch,
  updateAdminChurchSlug,
} from "@/app/admin/giving-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    </div>
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
