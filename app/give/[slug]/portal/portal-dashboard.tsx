"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { GiveForm } from "@/app/give/[slug]/give-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { giftStatus, intervalLabel, recurringState, recurringStatus } from "@/lib/giving/labels";
import type { GivingFundRow } from "@/types/giving";
import { formatCents } from "@/lib/utils/currency";
import { PORTAL_SECTIONS, type PortalSection } from "./portal-sections";

type Subscription = {
  id: string;
  amountCents: number;
  currency: string;
  interval: string;
  status: string;
  fundName: string;
  pausedAt: string | null;
};

type Gift = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  fundName: string;
  createdAt: string;
};

function CardUpdateForm({
  onDone,
}: {
  onDone: () => void;
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
    const { error: submitError } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    setLoading(false);
    if (submitError) {
      setError(submitError.message ?? "Could not update card");
      return;
    }
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={!stripe || loading}>
        {loading ? "Saving…" : "Save card"}
      </Button>
    </form>
  );
}

export function PortalDashboard({
  slug,
  churchName,
  stripeAccountId,
  logoUrl,
  givingPrimaryColor,
  funds,
  givingEnabled,
  donor,
  subscriptions,
  gifts,
  yearGiftCount,
  timeZone,
  year,
}: {
  slug: string;
  churchName: string;
  stripeAccountId: string;
  logoUrl: string | null;
  givingPrimaryColor: string | null;
  funds: GivingFundRow[];
  givingEnabled: boolean;
  donor: { name: string | null; email: string; hasStripeCustomer: boolean };
  subscriptions: Subscription[];
  gifts: Gift[];
  yearGiftCount: number;
  timeZone?: string;
  year: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [amountEdits, setAmountEdits] = useState<Record<string, string>>({});
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [cardMessage, setCardMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [section, setSection] = useState<PortalSection | null>(null);

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripePromise =
    publishableKey && stripeAccountId
      ? loadStripe(publishableKey, { stripeAccount: stripeAccountId })
      : null;

  // What a confirmed action changed, shown at once instead of after a reload.
  const [subscriptionOverrides, setSubscriptionOverrides] = useState<
    Record<string, Partial<Pick<Subscription, "status" | "pausedAt" | "amountCents">>>
  >({});
  const shownSubscriptions = subscriptions.map((s) =>
    subscriptionOverrides[s.id] ? { ...s, ...subscriptionOverrides[s.id] } : s,
  );

  const activeSubscriptions = shownSubscriptions.filter(
    (s) => recurringState(s.status, s.pausedAt) !== "cancelled",
  );
  const inactiveSubscriptions = shownSubscriptions.filter(
    (s) => recurringState(s.status, s.pausedAt) === "cancelled",
  );
  const hasFailedPayment = activeSubscriptions.some(
    (s) => recurringState(s.status, s.pausedAt) === "failed",
  );
  const canGive = givingEnabled && funds.length > 0;

  const subAction = (
    subId: string,
    action: "pause" | "resume" | "cancel" | "update_amount",
    newAmountCents?: number,
  ) => {
    setSubscriptionError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/give/portal/subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, subscriptionId: subId, action, newAmountCents }),
        });
        if (response.ok) {
          const change: Partial<Pick<Subscription, "status" | "pausedAt" | "amountCents">> =
            action === "cancel"
              ? { status: "canceled", pausedAt: null }
              : action === "pause"
                ? { pausedAt: new Date().toISOString() }
                : action === "resume"
                  ? { pausedAt: null }
                  : { amountCents: newAmountCents };
          setSubscriptionOverrides((prev) => ({ ...prev, [subId]: { ...prev[subId], ...change } }));
          if (action === "update_amount") setAmountEdits((prev) => ({ ...prev, [subId]: "" }));
          router.refresh();
          return;
        }
      } catch {
        // Show the same recovery message when the connection fails.
      }
      setSubscriptionError("We couldn't update your recurring gift. Please try again.");
    });
  };

  const startCardUpdate = () => {
    setCardMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/give/portal/setup-intent?slug=${encodeURIComponent(slug)}`,
          { method: "POST" },
        );
        if (response.ok) {
          const data = await response.json();
          if (data.clientSecret) {
            setSetupSecret(data.clientSecret);
            return;
          }
        }
      } catch {
        // Show the same recovery message when the connection fails.
      }
      setCardMessage({ text: "We couldn't open the card form. Please try again.", error: true });
    });
  };

  const signOut = () => {
    setSignOutError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/give/portal/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        if (!response.ok) {
          setSignOutError("We could not sign you out. Please try again.");
          return;
        }
        router.push(`/give/${slug}/portal`);
        router.refresh();
      } catch {
        setSignOutError("We could not sign you out. Please try again.");
      }
    });
  };

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold">Donor portal</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {donor.name ?? donor.email}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={signOut}>
          Sign out
        </Button>
      </div>

      {signOutError && <p role="alert" className="text-sm text-destructive">{signOutError}</p>}

      <section aria-labelledby="active-payments-title" className="space-y-3">
        <h2 id="active-payments-title" className="font-heading text-lg font-semibold">Active payments</h2>
        {hasFailedPayment && (
          <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <p>A recurring payment failed. Update your card to keep your gift active.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-controls="payment-methods"
              onClick={() => setSection("payment-methods")}
            >
              Open payment methods
            </Button>
          </div>
        )}
        {subscriptionError && <p role="alert" className="text-sm text-destructive">{subscriptionError}</p>}
        {activeSubscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active recurring payments.</p>
        ) : (
          <ul className="space-y-4">
            {activeSubscriptions.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-border p-4 text-sm"
              >
                <p className="font-medium">
                  {formatCents(s.amountCents, s.currency)} · {intervalLabel(s.interval)} ·{" "}
                  {s.fundName}
                </p>
                <p className="capitalize text-muted-foreground">{recurringStatus(s.status, s.pausedAt).label}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="1"
                      step="0.01"
                      className="w-24"
                      aria-label={`New gift amount for ${s.fundName}`}
                      placeholder="New $"
                      value={amountEdits[s.id] ?? ""}
                      onChange={(e) =>
                        setAmountEdits((prev) => ({
                          ...prev,
                          [s.id]: e.target.value,
                        }))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending || Number(amountEdits[s.id] ?? "") < 1}
                      onClick={() => {
                        const dollars = Number.parseFloat(
                          amountEdits[s.id] ?? "",
                        );
                        if (!dollars || dollars < 1) return;
                        subAction(
                          s.id,
                          "update_amount",
                          Math.round(dollars * 100),
                        );
                      }}
                    >
                      Change amount
                    </Button>
                  </div>
                  {s.status === "paused" || s.pausedAt ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => subAction(s.id, "resume")}
                    >
                      Resume
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => subAction(s.id, "pause")}
                    >
                      Pause
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={async () => {
                      if (await confirmAction({
                        title: "Cancel this recurring gift?",
                        confirmLabel: "Cancel recurring gift",
                        cancelLabel: "Keep recurring gift",
                        destructive: true,
                      })) {
                        subAction(s.id, "cancel");
                      }
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="group" aria-label="Donor portal actions" className="grid grid-cols-2 gap-2">
        {PORTAL_SECTIONS.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            variant={id === "give-now" || section === id ? "default" : "outline"}
            className="min-w-0 whitespace-normal px-2"
            aria-controls={id}
            aria-expanded={section === id}
            onClick={() => setSection(section === id ? null : id)}
          >
            {label}
          </Button>
        ))}
      </div>

      <section id="give-now" hidden={section !== "give-now"} aria-labelledby="give-now-title" className="space-y-3">
        <h2 id="give-now-title" className="font-heading text-lg font-semibold">Give now</h2>
        {canGive ? (
          <GiveForm
            timeZone={timeZone}
            mode="portal"
            slug={slug}
            churchName={churchName}
            stripeAccountId={stripeAccountId}
            logoUrl={logoUrl}
            givingPrimaryColor={givingPrimaryColor}
            funds={funds}
            lockedEmail={donor.email}
            lockedName={donor.name ?? ""}
            onPaymentSuccess={() => {
              setSection("payment-history");
              router.refresh();
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Online giving is currently unavailable.</p>
        )}
      </section>

      <section id="statements" hidden={section !== "statements"} aria-labelledby="statements-title" className="space-y-3">
        <h2 id="statements-title" className="font-heading text-lg font-semibold">Statements</h2>
        {yearGiftCount > 0 ? (
          <a
            href={`/api/give/portal/statement?slug=${encodeURIComponent(slug)}&year=${year}`}
            className={buttonVariants({ variant: "outline", className: "whitespace-normal" })}
          >
            Download {year} giving statement (PDF)
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">No gifts recorded for {year} yet.</p>
        )}
      </section>

      <section id="payment-methods" hidden={section !== "payment-methods"} aria-labelledby="payment-methods-title" className="space-y-3">
        <h2 id="payment-methods-title" className="font-heading text-lg font-semibold">Payment methods</h2>
        {cardMessage && (
          <p role={cardMessage.error ? "alert" : "status"} className={cardMessage.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {cardMessage.text}
          </p>
        )}
        {donor.hasStripeCustomer && stripePromise ? (
          setupSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret: setupSecret }}>
              <CardUpdateForm
                onDone={() => {
                  setSetupSecret(null);
                  setCardMessage({ text: "Your card was saved.", error: false });
                  router.refresh();
                }}
              />
            </Elements>
          ) : (
            <Button type="button" variant="outline" disabled={pending} onClick={startCardUpdate}>
              Update card
            </Button>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            {donor.hasStripeCustomer
              ? "Card updates are currently unavailable."
              : "Payment methods will be available after your first online gift."}
          </p>
        )}
      </section>

      <section id="payment-history" hidden={section !== "payment-history"} aria-labelledby="payment-history-title" className="space-y-3">
        <h2 id="payment-history-title" className="font-heading text-lg font-semibold">Payment history</h2>
        {gifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gifts yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {gifts.map((gift) => (
              <li key={gift.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2">
                <span>
                  {new Date(gift.createdAt).toLocaleDateString("en-US", { timeZone })} · {gift.fundName}
                </span>
                <span>
                  {formatCents(gift.amountCents, gift.currency)}{" "}
                  <span className="text-muted-foreground">({giftStatus(gift.status).label})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {inactiveSubscriptions.length > 0 && (
          <details className="rounded-lg border border-border p-4 text-sm">
            <summary className="cursor-pointer font-medium">Cancelled recurring gifts</summary>
            <ul className="mt-2 divide-y divide-border">
              {inactiveSubscriptions.map((s) => (
                <li key={s.id} className="py-2">
                  {formatCents(s.amountCents, s.currency)} · {intervalLabel(s.interval)} · {s.fundName}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
