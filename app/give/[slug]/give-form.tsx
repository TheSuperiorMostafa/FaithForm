"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { GivePageHeader } from "@/components/giving/give-page-header";
import {
  giveBtnCta,
  giveBtnPrimary,
  giveLinkAccent,
} from "@/components/giving/give-branded-styles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidHexColor } from "@/lib/giving/branding";
import {
  chargeCentsWithFeeCoverage,
  feeCoverageAmountCents,
} from "@/lib/giving/fees";
import type { GivingFundRow } from "@/types/giving";
import { formatCents } from "@/lib/utils/currency";
import { cn } from "@/lib/utils";

const PRESETS = [2500, 5000, 10000, 25000, 50000];

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

type GiveFormProps = {
  slug: string;
  churchName: string;
  stripeAccountId: string;
  logoUrl: string | null;
  givingPrimaryColor: string | null;
  funds: GivingFundRow[];
  mode?: "public" | "portal";
  lockedEmail?: string;
  lockedName?: string;
  onPaymentSuccess?: () => void;
  /**
   * Preselected gift, in cents. Set when a visitor picked an amount on their
   * church's website before landing here, so the choice they just made is not
   * silently reset to the default.
   */
  initialAmountCents?: number;
};

function CheckoutForm({
  slug,
  isPortal,
  donorEmail,
  onSuccess,
}: {
  slug: string;
  isPortal?: boolean;
  donorEmail?: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(null);

    const thankYouUrl = donorEmail
      ? `${window.location.origin}/give/${slug}/thank-you?email=${encodeURIComponent(donorEmail)}`
      : `${window.location.origin}/give/${slug}/thank-you`;

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: isPortal
          ? `${window.location.origin}/give/${slug}/portal`
          : thankYouUrl,
      },
      redirect: "if_required",
    });

    setLoading(false);
    if (submitError) {
      setError(submitError.message ?? "Payment failed");
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button type="submit" className={giveBtnCta()} disabled={!stripe || loading}>
        {loading ? "Processing…" : "Complete gift"}
      </button>
    </form>
  );
}

export function GiveForm({
  slug,
  churchName,
  stripeAccountId,
  logoUrl,
  givingPrimaryColor,
  funds,
  mode = "public",
  lockedEmail,
  lockedName,
  onPaymentSuccess,
  initialAmountCents,
}: GiveFormProps) {
  const router = useRouter();
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const isPortal = mode === "portal";

  const defaultFund = funds.find((f) => f.isDefault) ?? funds[0];

  // An incoming amount that is not one of the presets still has to be honoured,
  // so it drops into the custom field rather than being rounded to a preset.
  const presetMatch =
    initialAmountCents && PRESETS.includes(initialAmountCents)
      ? initialAmountCents
      : null;

  const [amountCents, setAmountCents] = useState(presetMatch ?? 5000);
  const [amountMode, setAmountMode] = useState<"preset" | "custom">(
    initialAmountCents && !presetMatch ? "custom" : "preset",
  );
  const [customAmount, setCustomAmount] = useState(
    initialAmountCents && !presetMatch ? (initialAmountCents / 100).toFixed(2) : "",
  );
  const [giftType, setGiftType] = useState<"one_time" | "recurring">("one_time");
  const [interval, setInterval] = useState<"week" | "month">("month");
  const [billingDayOfMonth, setBillingDayOfMonth] = useState(1);
  const [billingDayOfWeek, setBillingDayOfWeek] = useState(() => new Date().getDay());
  const [donorName, setDonorName] = useState(lockedName ?? "");
  const [donorEmail, setDonorEmail] = useState(lockedEmail ?? "");
  const [fundId, setFundId] = useState(defaultFund?.id ?? "");
  const [coverFees, setCoverFees] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [step, setStep] = useState<"amount" | "pay">("amount");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultFund && !fundId) setFundId(defaultFund.id);
  }, [defaultFund, fundId]);

  if (!publishableKey) {
    return (
      <p className="text-sm text-muted-foreground">Giving is not configured.</p>
    );
  }

  const stripePromise = loadStripe(publishableKey, {
    stripeAccount: stripeAccountId,
  });

  const resolvedAmount =
    amountMode === "custom" && customAmount
      ? Math.round(Number.parseFloat(customAmount) * 100)
      : amountCents;

  const feeExtra = coverFees ? feeCoverageAmountCents(resolvedAmount) : 0;
  const chargeAmount = coverFees
    ? chargeCentsWithFeeCoverage(resolvedAmount)
    : resolvedAmount;

  const stripeAppearance =
    givingPrimaryColor && isValidHexColor(givingPrimaryColor)
      ? { theme: "stripe" as const, variables: { colorPrimary: givingPrimaryColor } }
      : { theme: "stripe" as const };

  const startPayment = async () => {
    if (!resolvedAmount || resolvedAmount < 100) {
      setError(amountMode === "custom" ? "Enter an amount of at least $1.00" : "Minimum gift is $1.00");
      return;
    }
    if (!donorName.trim()) {
      setError("Name is required.");
      return;
    }
    if (!isPortal && !donorEmail.trim()) {
      setError("Email is required.");
      return;
    }
    if (!fundId) {
      setError("Please select a fund.");
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = isPortal
      ? giftType === "one_time"
        ? "/api/give/portal/create-intent"
        : "/api/give/portal/create-subscription"
      : giftType === "one_time"
        ? "/api/give/create-intent"
        : "/api/give/create-subscription";

    const body =
      giftType === "one_time"
        ? {
            slug,
            amountCents: chargeAmount,
            intendedAmountCents: resolvedAmount,
            coverFees,
            ...(isPortal
              ? { donorName: donorName.trim() }
              : {
                  donorEmail: donorEmail.trim(),
                  donorName: donorName.trim(),
                }),
            fundId,
          }
        : {
            slug,
            amountCents: chargeAmount,
            intendedAmountCents: resolvedAmount,
            coverFees,
            interval,
            billingDayOfMonth: interval === "month" ? billingDayOfMonth : undefined,
            billingDayOfWeek: interval === "week" ? billingDayOfWeek : undefined,
            ...(isPortal
              ? { donorName: donorName.trim() }
              : {
                  donorEmail: donorEmail.trim(),
                  donorName: donorName.trim(),
                }),
            fundId,
          };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok || !data.clientSecret) {
      setError(data.error ?? "Could not start payment");
      return;
    }

    setClientSecret(data.clientSecret);
    setStep("pay");
  };

  const handlePaymentSuccess = () => {
    if (isPortal && onPaymentSuccess) {
      setStep("amount");
      setClientSecret(null);
      onPaymentSuccess();
      return;
    }
    router.push(
      `/give/${slug}/thank-you?email=${encodeURIComponent(donorEmail.trim())}`,
    );
  };

  if (step === "pay" && clientSecret) {
    return (
      <div className="space-y-4">
        {!isPortal && (
          <GivePageHeader churchName={churchName} logoUrl={logoUrl} showRateNote={false} titleAs="h2" />
        )}
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: stripeAppearance,
          }}
        >
          <CheckoutForm
            slug={slug}
            isPortal={isPortal}
            donorEmail={donorEmail.trim() || undefined}
            onSuccess={handlePaymentSuccess}
          />
        </Elements>
        <Button variant="ghost" type="button" onClick={() => setStep("amount")}>
          ← Change amount
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!isPortal && <GivePageHeader churchName={churchName} logoUrl={logoUrl} />}

      <div className="flex gap-2">
        <button
          type="button"
          className={cn(giveBtnPrimary(giftType === "one_time"), "h-10 flex-1 px-4")}
          onClick={() => setGiftType("one_time")}
        >
          One-time
        </button>
        <button
          type="button"
          className={cn(giveBtnPrimary(giftType === "recurring"), "h-10 flex-1 px-4")}
          onClick={() => setGiftType("recurring")}
        >
          Recurring
        </button>
      </div>

      {giftType === "recurring" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              className={cn(giveBtnPrimary(interval === "week"), "h-8 px-3 text-sm")}
              onClick={() => setInterval("week")}
            >
              Weekly
            </button>
            <button
              type="button"
              className={cn(giveBtnPrimary(interval === "month"), "h-8 px-3 text-sm")}
              onClick={() => setInterval("month")}
            >
              Monthly
            </button>
          </div>

          {interval === "month" ? (
            <div className="space-y-2">
              <Label htmlFor="billing-day-month">Gift date each month</Label>
              <select
                id="billing-day-month"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={billingDayOfMonth}
                onChange={(e) => setBillingDayOfMonth(Number.parseInt(e.target.value, 10))}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                    {day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"} of the month
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="billing-day-week">Gift day each week</Label>
              <select
                id="billing-day-week"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={billingDayOfWeek}
                onChange={(e) => setBillingDayOfWeek(Number.parseInt(e.target.value, 10))}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Your first gift processes today. Future gifts run on this schedule.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((cents) => (
          <button
            key={cents}
            type="button"
            className={cn(
              giveBtnPrimary(amountMode === "preset" && amountCents === cents),
              "h-10 px-3",
            )}
            onClick={() => {
              setAmountCents(cents);
              setAmountMode("preset");
              setCustomAmount("");
            }}
          >
            ${cents / 100}
          </button>
        ))}
        <button
          type="button"
          className={cn(giveBtnPrimary(amountMode === "custom"), "h-10 px-3")}
          onClick={() => {
            setAmountMode("custom");
            setCustomAmount("");
          }}
        >
          Custom
        </button>
      </div>

      {amountMode === "custom" && (
        <Input
          type="number"
          min="1"
          step="0.01"
          placeholder="Enter amount"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          autoFocus
        />
      )}

      <div className="space-y-2">
        <Label htmlFor="fund">Fund</Label>
        <select
          id="fund"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={fundId}
          onChange={(e) => setFundId(e.target.value)}
        >
          {funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          required
          value={donorName}
          onChange={(e) => setDonorName(e.target.value)}
          autoComplete="name"
        />
      </div>

      {isPortal ? (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={lockedEmail ?? donorEmail}
            readOnly
            className="bg-muted"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={donorEmail}
            onChange={(e) => setDonorEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          className="mt-1"
          checked={coverFees}
          onChange={(e) => setCoverFees(e.target.checked)}
        />
        <span className="text-sm">
          Add {formatCents(feeCoverageAmountCents(resolvedAmount || 0))} to cover
          processing fees so the church receives the full{" "}
          {formatCents(resolvedAmount || 0)}.
        </span>
      </label>

      {coverFees && resolvedAmount >= 100 && (
        <p className="text-sm text-muted-foreground">
          Gift: {formatCents(resolvedAmount)} · Fee coverage:{" "}
          {formatCents(feeExtra)} · Total charge: {formatCents(chargeAmount)}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <button
        type="button"
        className={giveBtnCta("h-11 text-base")}
        disabled={loading}
        onClick={startPayment}
      >
        {loading ? "Please wait…" : "Continue to payment"}
      </button>

      {!isPortal && (
        <a
          href={`/give/${slug}/portal`}
          className="mt-4 block rounded-lg border border-border bg-muted/30 p-4 text-center transition-colors hover:bg-muted/50"
        >
          <span className={giveLinkAccent("block text-sm font-semibold")}>
            Donor portal
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Manage recurring gifts, update your card, download statements
          </span>
        </a>
      )}
    </div>
  );
}
