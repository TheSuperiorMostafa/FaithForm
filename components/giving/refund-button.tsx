"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { donorDisplayName, isRefundable } from "@/lib/giving/labels";
import { formatCents } from "@/lib/utils/currency";
import type { GivingDonationRow } from "@/types/giving";

/**
 * Refunding a gift sends money back and can't be undone, so the confirmation
 * names the amount, the donor and the consequence, and the button says
 * exactly what it does ("Refund $50.00"). It follows the `confirmAction`
 * pattern, as a dialog of its own so the optional reason (kept on the gift
 * and in the spreadsheet download) still has somewhere to go.
 *
 * Only offered on received gifts: the refund route refuses anything else.
 */
export function RefundButton({ donation }: { donation: GivingDonationRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = useId();
  const reasonId = useId();

  if (!isRefundable(donation)) return null;

  const amount = formatCents(donation.amountCents, donation.currency);
  const donor = donorDisplayName(donation);

  const close = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setError(null);
      setReason("");
    }
  };

  const refund = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/dashboard/giving/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            donationId: donation.id,
            reason: reason.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          setError(
            data?.error ??
              "We couldn't refund this gift. Nothing was refunded. Please try again.",
          );
          return;
        }
        setOpen(false);
        setReason("");
        toast.success(`Refunded ${amount} to ${donor}. It shows as Refunded in a minute or two.`);
        router.refresh();
      } catch {
        setError("We couldn't reach the server. Nothing was refunded. Check your connection and try again.");
      }
    });
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Undo2 aria-hidden />
        Refund
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent role="alertdialog" aria-labelledby={titleId} showClose={false}>
          <DialogHeader className="flex-row items-start gap-4 border-b-0 pb-2">
            <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-5" aria-hidden />
            </span>
            <div className="space-y-2">
              <DialogTitle id={titleId}>
                Refund {amount} to {donor}?
              </DialogTitle>
              <DialogDescription className="text-base">
                The whole gift goes back to the card they gave with. It usually arrives in 5 to 10
                days. This can&apos;t be undone.
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-2 px-6 pb-2">
            <Label htmlFor={reasonId}>Reason (optional)</Label>
            <Input
              id={reasonId}
              value={reason}
              maxLength={500}
              placeholder="Given twice by mistake"
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              Only your team sees this. It&apos;s saved with the gift.
            </p>
            {error && (
              <p role="alert" className="text-[15px] font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter className="border-t-0 pt-4">
            <Button variant="outline" autoFocus disabled={pending} onClick={() => close(false)}>
              Go back
            </Button>
            <Button
              disabled={pending}
              onClick={refund}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground"
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Refund {amount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
