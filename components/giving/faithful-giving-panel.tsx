"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  loadFaithfulGiving,
  saveFundPublication,
} from "@/app/dashboard/giving/faithful-actions";
import type { PublishableFund, StripeReadiness } from "@/lib/giving/v1/publication";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Publishing a giving fund to the Faithful apps.
 *
 * ## What this screen is, and is not
 *
 * It is the minimum a church needs so a visitor can give safely: which funds
 * appear, what they are called, what amounts are suggested, and what the bounds
 * are. It shows Stripe readiness plainly and refuses to publish without it.
 *
 * It is **not** a financial screen. No totals, no goals, no donor counts, no
 * fundraising progress, and no tax language — none of which the canonical data
 * supports, and all of which would be a number a church would then have to
 * defend. Payouts, refunds, reconciliation and reporting are elsewhere in this
 * dashboard and are untouched.
 */

const VISIBILITY_LABELS = {
  none: "Not in Faithful",
  public: "Everyone",
  followers: "Followers and members",
  members: "Members only",
} as const;

type Visibility = keyof typeof VISIBILITY_LABELS;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

function parseAmountToCents(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

/** What a church is missing, in the order it has to fix it. */
function readinessMessage(readiness: StripeReadiness): string | null {
  if (!readiness.connected) {
    return "This church hasn't connected a Stripe account yet. Until it does, funds can't be published to the app.";
  }
  if (!readiness.detailsSubmitted) {
    return "Stripe setup isn't finished. Complete it before publishing a fund to the app.";
  }
  if (!readiness.chargesEnabled) {
    return "Stripe hasn't enabled payments for this church yet. Funds can't be published until it does.";
  }
  if (!readiness.givingFeatureEnabled) {
    return "Giving is switched off for this church, so nothing is shown in the app.";
  }
  return null;
}

export function FaithfulGivingPanel({ isAdmin }: { isAdmin: boolean }) {
  const [readiness, setReadiness] = useState<StripeReadiness | null>(null);
  const [funds, setFunds] = useState<PublishableFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PublishableFund | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setLoading(true);
    const state = await loadFaithfulGiving();
    setReadiness(state?.readiness ?? null);
    setFunds(state?.funds ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const warning = readiness ? readinessMessage(readiness) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Giving in the app</CardTitle>
        <CardDescription>
          Choose which funds people can give to in Faithful. Payouts, refunds and
          reporting stay in the rest of this dashboard.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
          Readiness first, because it is the thing that stops everything else.
          A church looking at a row of disabled buttons deserves to know why
          before it starts pressing them.
        */}
        {readiness ? (
          <div
            className={`rounded-md border p-3 text-sm ${
              readiness.canAcceptPayments
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}
            role={readiness.canAcceptPayments ? undefined : "alert"}
          >
            <p className="font-medium">
              {readiness.canAcceptPayments
                ? "This church can accept gifts in the app."
                : "This church can't accept gifts in the app yet."}
            </p>
            {warning ? <p className="mt-1">{warning}</p> : null}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading funds…</p>
        ) : funds.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No funds yet. Create one in giving settings, then publish it here.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {funds.map((fund) => (
              <li
                key={fund.fundId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{fund.previewTitle}</span>
                    <Badge variant={fund.visibility === "none" ? "outline" : "default"}>
                      {VISIBILITY_LABELS[fund.visibility as Visibility]}
                    </Badge>
                    {fund.isActive ? null : <Badge variant="outline">Inactive</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCents(fund.minAmountCents)} – {formatCents(fund.maxAmountCents)}
                    {fund.suggestedAmounts.length > 0
                      ? ` · suggests ${fund.suggestedAmounts.map(formatCents).join(", ")}`
                      : ""}
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isAdmin || (!fund.canPublish && fund.visibility === "none")}
                  onClick={() => setEditing(fund)}
                >
                  {fund.visibility === "none" ? "Publish" : "Edit"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing ? (
        <FundDialog
          fund={editing}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(input) => {
            startTransition(async () => {
              const result = await saveFundPublication({ fundId: editing.fundId, ...input });
              if (!result.ok) {
                toast.error(result.error ?? "Could not save that.");
                return;
              }
              toast.success(
                input.visibility === "none"
                  ? "Removed from the app."
                  : "Saved. It's in the app now.",
              );
              setEditing(null);
              await refresh();
            });
          }}
        />
      ) : null}
    </Card>
  );
}

function FundDialog({
  fund,
  pending,
  onClose,
  onSave,
}: {
  fund: PublishableFund;
  pending: boolean;
  onClose: () => void;
  onSave: (input: {
    visibility: Visibility;
    title: string | null;
    description: string | null;
    suggestedAmounts: number[];
    minAmountCents: number;
    maxAmountCents: number;
  }) => void;
}) {
  const [visibility, setVisibility] = useState<Visibility>(fund.visibility as Visibility);
  const [title, setTitle] = useState(fund.title ?? "");
  const [description, setDescription] = useState(fund.description ?? "");
  const [minimum, setMinimum] = useState(String(fund.minAmountCents / 100));
  const [maximum, setMaximum] = useState(String(fund.maxAmountCents / 100));
  const [suggested, setSuggested] = useState(
    fund.suggestedAmounts.map((cents) => String(cents / 100)).join(", "),
  );

  const min = parseAmountToCents(minimum);
  const max = parseAmountToCents(maximum);
  const suggestedCents = suggested
    .split(",")
    .map(parseAmountToCents)
    .filter((value): value is number => value !== null);

  const amountsValid = min !== null && max !== null && max >= min;
  const previewTitle = title.trim() || fund.name;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{fund.name} in Faithful</DialogTitle>
          <DialogDescription>
            What people see when they open giving in the app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who can see it</legend>
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                />
                {VISIBILITY_LABELS[value]}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="fund-title">Title</Label>
            <Input
              id="fund-title"
              value={title}
              maxLength={120}
              placeholder={fund.name}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="fund-description">Description</Label>
            <Textarea
              id="fund-description"
              value={description}
              maxLength={600}
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label htmlFor="fund-min">Minimum</Label>
              <Input
                id="fund-min"
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fund-max">Maximum</Label>
              <Input
                id="fund-max"
                inputMode="decimal"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fund-suggested">Suggested amounts</Label>
            <Input
              id="fund-suggested"
              value={suggested}
              placeholder="25, 50, 100"
              onChange={(event) => setSuggested(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Shown as buttons. Anyone can still type their own amount.
            </p>
          </div>

          {/*
            The preview is the same shape the app draws, so a church sees what it
            is publishing rather than a form. It shows no total and no goal,
            because there is no such number to show.
          */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              What people will see
            </p>
            <p className="mt-2 font-medium">{previewTitle}</p>
            {description.trim() ? (
              <p className="mt-1 text-sm text-muted-foreground">{description.trim()}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {suggestedCents.length > 0 ? (
                suggestedCents.map((cents) => (
                  <span
                    key={cents}
                    className="rounded-full border px-3 py-1 text-sm"
                  >
                    {formatCents(cents)}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">No suggested amounts</span>
              )}
            </div>
            {amountsValid ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {formatCents(min)} minimum · {formatCents(max)} maximum
              </p>
            ) : (
              <p className="mt-2 text-xs text-destructive" role="alert">
                Check the minimum and maximum.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending || !amountsValid}
            onClick={() =>
              onSave({
                visibility,
                title: title.trim() || null,
                description: description.trim() || null,
                suggestedAmounts: suggestedCents,
                minAmountCents: min ?? 100,
                maxAmountCents: max ?? 500000,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
