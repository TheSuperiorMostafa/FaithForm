"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  loadFaithFormGiving,
  saveFundPublication,
} from "@/app/dashboard/giving/faithform-actions";
import type { PublishableFund, StripeReadiness } from "@/lib/giving/v1/publication";
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
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";

/**
 * Publishing a giving fund to the FaithForm app.
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
  none: "Not in the app",
  public: "Everyone",
  followers: "People who follow your church, and members",
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
    return "Your church hasn't connected its bank yet. Until it does, funds can't be shown in the app.";
  }
  if (!readiness.detailsSubmitted) {
    return "Your bank connection isn't finished. Finish it before showing a fund in the app.";
  }
  if (!readiness.chargesEnabled) {
    return "Your bank details are still being checked. Funds can be shown in the app once that's done.";
  }
  if (!readiness.givingFeatureEnabled) {
    return "Giving is switched off for your church, so nothing is shown in the app.";
  }
  return null;
}

export function FaithFormGivingPanel({ isAdmin }: { isAdmin: boolean }) {
  const [readiness, setReadiness] = useState<StripeReadiness | null>(null);
  const [funds, setFunds] = useState<PublishableFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<PublishableFund | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const state = await loadFaithFormGiving();
      setReadiness(state?.readiness ?? null);
      setFunds(state?.funds ?? []);
      setFailed(state === null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const warning = readiness ? readinessMessage(readiness) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold">Giving in the FaithForm app</CardTitle>
        <CardDescription className="text-[15px]">
          Choose which funds people can give to in the FaithForm app, and who sees them.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
          Readiness first, because it is the thing that stops everything else.
          A church looking at a row of disabled buttons deserves to know why
          before it starts pressing them.
        */}
        {readiness && !readiness.canAcceptPayments ? (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[15px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
            role="alert"
          >
            <p className="font-semibold">Your church can&apos;t receive gifts in the app yet.</p>
            {warning ? <p className="mt-1">{warning}</p> : null}
          </div>
        ) : null}

        {loading ? (
          <SkeletonContainer label="funds in the app" className="space-y-0">
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {Array.from({ length: 3 }).map((_, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                  <Skeleton className="h-11 w-24 rounded-[10px]" />
                </li>
              ))}
            </ul>
          </SkeletonContainer>
        ) : failed ? (
          <ErrorState
            compact
            title="Your app funds didn't load"
            description="Nothing was changed. Try again in a moment."
            onRetry={() => void refresh()}
          />
        ) : funds.length === 0 ? (
          <p className="text-[15px] text-muted-foreground">
            No funds yet. Add one under Funds above, then choose here whether it shows in the app.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {funds.map((fund) => (
              <li
                key={fund.fundId}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold">{fund.previewTitle}</span>
                    <StatusBadge tone={fund.visibility === "none" ? "neutral" : "done"}>
                      {fund.visibility === "none"
                        ? VISIBILITY_LABELS.none
                        : `In the app: ${VISIBILITY_LABELS[fund.visibility as Visibility]}`}
                    </StatusBadge>
                    {fund.isActive ? null : <StatusBadge tone="neutral">Removed</StatusBadge>}
                  </div>
                  <p className="mt-1 text-[15px] text-muted-foreground">
                    {formatCents(fund.minAmountCents)} to {formatCents(fund.maxAmountCents)}
                    {fund.suggestedAmounts.length > 0
                      ? ` · buttons for ${fund.suggestedAmounts.map(formatCents).join(", ")}`
                      : ""}
                  </p>
                </div>

                <Button
                  variant="outline"
                  disabled={!isAdmin || (!fund.canPublish && fund.visibility === "none")}
                  onClick={() => setEditing(fund)}
                >
                  {fund.visibility === "none" ? "Show in app" : "Change"}
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
              try {
                const result = await saveFundPublication({ fundId: editing.fundId, ...input });
                if (!result.ok) {
                  toast.error(result.error ?? "We couldn't save that. Please try again.");
                  return;
                }
                const title = input.title ?? editing.name;
                toast.success(
                  input.visibility === "none"
                    ? `${title} is no longer in the app.`
                    : `${title} is in the app for ${VISIBILITY_LABELS[input.visibility].toLowerCase()}.`,
                );
                setEditing(null);
                await refresh();
              } catch {
                toast.error("We couldn't save that. Please try again.");
              }
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
          <DialogTitle>{fund.name} in the app</DialogTitle>
          <DialogDescription className="text-[15px]">
            What people see when they open giving in the FaithForm app.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <fieldset className="space-y-2">
            <legend className="text-[15px] font-semibold">Who can see it</legend>
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-3 text-[15px]">
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
            <Label htmlFor="fund-title">Name in the app</Label>
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
              <Label htmlFor="fund-min">Smallest gift ($)</Label>
              <Input
                id="fund-min"
                inputMode="decimal"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fund-max">Largest gift ($)</Label>
              <Input
                id="fund-max"
                inputMode="decimal"
                value={maximum}
                onChange={(event) => setMaximum(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="fund-suggested">Amount buttons ($)</Label>
            <Input
              id="fund-suggested"
              value={suggested}
              placeholder="25, 50, 100"
              onChange={(event) => setSuggested(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Separate amounts with commas. Anyone can still type their own amount.
            </p>
          </div>

          {/*
            The preview is the same shape the app draws, so a church sees what it
            is publishing rather than a form. It shows no total and no goal,
            because there is no such number to show.
          */}
          <div className="rounded-lg border bg-muted/40 p-4">
            <p className="text-sm font-semibold text-muted-foreground">
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
              <p className="mt-2 text-sm text-muted-foreground">
                {formatCents(min)} smallest · {formatCents(max)} largest
              </p>
            ) : (
              <p className="mt-2 text-sm text-destructive" role="alert">
                Check the smallest and largest gift. The largest must be more than the smallest.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
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
            {visibility !== "none"
              ? "Save and show in app"
              : fund.visibility === "none"
                ? "Save"
                : "Take out of the app"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
