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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  chargeCentsWithFeeCoverage,
  feeCoverageAmountCents,
} from "@/lib/giving/fees";
import { STRIPE_NONPROFIT_RATE_LABEL } from "@/lib/stripe/config";
import type { GivingFundRow } from "@/types/giving";
import { formatCents } from "@/lib/utils/currency";

const PRESETS = [2500, 5000, 10000, 25000, 50000];

type GiveFormProps = {
  slug: string;
  churchName: string;
  stripeAccountId: string;
  funds: GivingFundRow[];
};

function CheckoutForm({
  slug,
  onSuccess,
}: {
  slug: string;
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

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/give/${slug}/thank-you`,
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
      <Button type="submit" className="w-full" disabled={!stripe || loading}>
        {loading ? "Processing…" : "Complete gift"}
      </Button>
    </form>
  );
}

export function GiveForm({
  slug,
  churchName,
  stripeAccountId,
  funds,
}: GiveFormProps) {
  const router = useRouter();
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const defaultFund = funds.find((f) => f.isDefault) ?? funds[0];

  const [amountCents, setAmountCents] = useState(5000);
  const [customAmount, setCustomAmount] = useState("");
  const [giftType, setGiftType] = useState<"one_time" | "recurring">("one_time");
  const [interval, setInterval] = useState<"week" | "month">("month");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
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

  const resolvedAmount = customAmount
    ? Math.round(Number.parseFloat(customAmount) * 100)
    : amountCents;

  const feeExtra = coverFees ? feeCoverageAmountCents(resolvedAmount) : 0;
  const chargeAmount = coverFees
    ? chargeCentsWithFeeCoverage(resolvedAmount)
    : resolvedAmount;

  const startPayment = async () => {
    if (!resolvedAmount || resolvedAmount < 100) {
      setError("Minimum gift is $1.00");
      return;
    }
    if (!donorName.trim()) {
      setError("Name is required.");
      return;
    }
    if (!donorEmail.trim()) {
      setError("Email is required.");
      return;
    }
    if (!fundId) {
      setError("Please select a fund.");
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint =
      giftType === "one_time"
        ? "/api/give/create-intent"
        : "/api/give/create-subscription";

    const body =
      giftType === "one_time"
        ? {
            slug,
            amountCents: chargeAmount,
            intendedAmountCents: resolvedAmount,
            coverFees,
            donorEmail: donorEmail.trim(),
            donorName: donorName.trim(),
            fundId,
          }
        : {
            slug,
            amountCents: chargeAmount,
            intendedAmountCents: resolvedAmount,
            coverFees,
            interval,
            donorEmail: donorEmail.trim(),
            donorName: donorName.trim(),
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

  if (step === "pay" && clientSecret) {
    return (
      <div className="space-y-4">
        <h2 className="font-heading text-xl font-bold">{churchName}</h2>
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret,
            appearance: { theme: "stripe" },
          }}
        >
          <CheckoutForm
            slug={slug}
            onSuccess={() => router.push(`/give/${slug}/thank-you`)}
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
      <div>
        <h1 className="font-heading text-2xl font-bold">{churchName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Give securely. Processing: {STRIPE_NONPROFIT_RATE_LABEL}. No FaithForm fee.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={giftType === "one_time" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setGiftType("one_time")}
        >
          One-time
        </Button>
        <Button
          type="button"
          variant={giftType === "recurring" ? "default" : "outline"}
          className="flex-1"
          onClick={() => setGiftType("recurring")}
        >
          Recurring
        </Button>
      </div>

      {giftType === "recurring" && (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={interval === "week" ? "default" : "outline"}
            onClick={() => setInterval("week")}
          >
            Weekly
          </Button>
          <Button
            type="button"
            size="sm"
            variant={interval === "month" ? "default" : "outline"}
            onClick={() => setInterval("month")}
          >
            Monthly
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((cents) => (
          <Button
            key={cents}
            type="button"
            variant={amountCents === cents && !customAmount ? "default" : "outline"}
            onClick={() => {
              setAmountCents(cents);
              setCustomAmount("");
            }}
          >
            ${cents / 100}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="custom">Custom amount ($)</Label>
        <Input
          id="custom"
          type="number"
          min="1"
          step="0.01"
          placeholder="Other amount"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
        />
      </div>

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

      <Button
        type="button"
        className="w-full"
        size="lg"
        disabled={loading}
        onClick={startPayment}
      >
        {loading ? "Please wait…" : "Continue to payment"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <a href={`/give/${slug}/portal`} className="underline hover:text-foreground">
          Donor portal — manage recurring gifts
        </a>
      </p>
    </div>
  );
}
