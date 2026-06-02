"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GivingDonationRow } from "@/types/giving";

export function RefundButton({ donation }: { donation: GivingDonationRow }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (
    donation.status === "refunded" ||
    donation.status === "failed" ||
    !donation.stripePaymentIntentId
  ) {
    return null;
  }

  const handleRefund = () => {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/dashboard/giving/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donationId: donation.id,
          reason: reason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Refund failed");
        return;
      }
      setOpen(false);
      window.location.reload();
    });
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Refund
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <Label htmlFor={`reason-${donation.id}`}>Reason (optional)</Label>
      <Input
        id={`reason-${donation.id}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Duplicate gift, requested by donor…"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={handleRefund}
        >
          {pending ? "Refunding…" : "Confirm refund"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
