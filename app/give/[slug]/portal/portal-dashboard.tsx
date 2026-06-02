"use client";

import { useState, useTransition } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/utils/currency";

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
  giftType: string;
  fundName: string;
  createdAt: string;
};

function CardUpdateForm({
  slug,
  stripeAccountId,
  onDone,
}: {
  slug: string;
  stripeAccountId: string;
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
  donor,
  subscriptions,
  gifts,
  yearGiftCount,
  donorId,
  year,
}: {
  slug: string;
  churchName: string;
  stripeAccountId: string;
  donor: { name: string | null; email: string; hasStripeCustomer: boolean };
  subscriptions: Subscription[];
  gifts: Gift[];
  yearGiftCount: number;
  donorId: string;
  year: number;
}) {
  const [pending, startTransition] = useTransition();
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [amountEdits, setAmountEdits] = useState<Record<string, string>>({});

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripePromise =
    publishableKey && stripeAccountId
      ? loadStripe(publishableKey, { stripeAccount: stripeAccountId })
      : null;

  const failedSubs = subscriptions.filter(
    (s) => s.status === "past_due" || s.status === "unpaid",
  );

  const subAction = (
    subId: string,
    action: "pause" | "resume" | "cancel" | "update_amount",
    newAmountCents?: number,
  ) => {
    startTransition(async () => {
      await fetch("/api/give/portal/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          subscriptionId: subId,
          action,
          newAmountCents,
        }),
      });
      window.location.reload();
    });
  };

  const startCardUpdate = () => {
    startTransition(async () => {
      const res = await fetch(
        `/api/give/portal/setup-intent?slug=${encodeURIComponent(slug)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (data.clientSecret) setSetupSecret(data.clientSecret);
    });
  };

  return (
    <div className="mx-auto max-w-lg space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-bold">{churchName}</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {donor.name ?? donor.email}
        </p>
      </div>

      {failedSubs.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Payment failed</p>
          <p className="mt-1 text-muted-foreground">
            Update your card below to keep your recurring gift active.
          </p>
        </div>
      )}

      {donor.hasStripeCustomer && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Payment method</h2>
          {!setupSecret ? (
            <Button type="button" variant="outline" onClick={startCardUpdate}>
              Update card
            </Button>
          ) : (
            stripePromise && (
              <Elements
                stripe={stripePromise}
                options={{ clientSecret: setupSecret }}
              >
                <CardUpdateForm
                  slug={slug}
                  stripeAccountId={stripeAccountId}
                  onDone={() => {
                    setSetupSecret(null);
                    window.location.reload();
                  }}
                />
              </Elements>
            )
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Recurring gifts</h2>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring gifts.</p>
        ) : (
          <ul className="space-y-4">
            {subscriptions.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-border p-4 text-sm"
              >
                <p className="font-medium">
                  {formatCents(s.amountCents, s.currency)} / {s.interval} ·{" "}
                  {s.fundName}
                </p>
                <p className="capitalize text-muted-foreground">{s.status}</p>
                {s.status !== "canceled" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        step="0.01"
                        className="h-8 w-24"
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
                        disabled={pending}
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
                      onClick={() => {
                        if (
                          window.confirm(
                            "Cancel this recurring gift?",
                          )
                        ) {
                          subAction(s.id, "cancel");
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Gift history</h2>
        {gifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gifts yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {gifts.map((g) => (
              <li key={g.id} className="flex justify-between py-2">
                <span>
                  {new Date(g.createdAt).toLocaleDateString()} · {g.fundName}
                </span>
                <span>
                  {formatCents(g.amountCents, g.currency)}{" "}
                  <span className="text-muted-foreground">({g.status})</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Tax statements</h2>
        {yearGiftCount > 0 ? (
          <a
            href={`/api/give/portal/statement?slug=${slug}&year=${year}`}
            className="inline-flex text-sm font-medium text-accent underline"
          >
            Download {year} giving statement (PDF)
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">
            No gifts recorded for {year} yet.
          </p>
        )}
      </section>

      <p className="text-center text-xs text-muted-foreground">
        <a href={`/give/${slug}`} className="underline hover:text-foreground">
          Make a gift
        </a>
      </p>
    </div>
  );
}
