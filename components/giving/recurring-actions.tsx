"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Pause, Play, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { donorDisplayName, intervalLabel, recurringState } from "@/lib/giving/labels";
import { formatCents } from "@/lib/utils/currency";
import type { GivingSubscriptionRow } from "@/types/giving";

type Action = "pause" | "resume" | "cancel";

/**
 * Pause, resume or cancel a recurring gift. Each one reads the server's
 * answer and says what happened; cancelling asks first, because it can't be
 * undone (the donor would have to start a new recurring gift).
 */
export function RecurringActions({ subscription }: { subscription: GivingSubscriptionRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const state = recurringState(subscription.status, subscription.pausedAt);
  const donor = donorDisplayName(subscription);
  const gift = `${formatCents(subscription.amountCents, subscription.currency)} ${intervalLabel(subscription.interval).toLowerCase()}`;

  if (state === "cancelled") return null;

  const run = async (action: Action) => {
    if (action === "cancel") {
      const ok = await confirmAction({
        title: `Cancel ${donor}'s recurring gift?`,
        description: `Their gift of ${gift} stops, and they won't be charged again. This can't be undone. To give again, they would start a new recurring gift.`,
        confirmLabel: "Cancel recurring gift",
        cancelLabel: "Keep it",
        destructive: true,
      });
      if (!ok) return;
    }

    startTransition(async () => {
      try {
        const res = await fetch(`/api/dashboard/giving/subscriptions/${subscription.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) {
          toast.error(data?.error ?? "That didn't work. Nothing was changed. Please try again.");
          return;
        }
        toast.success(
          action === "pause"
            ? `Paused ${donor}'s gift. They won't be charged until you resume it.`
            : action === "resume"
              ? `Resumed ${donor}'s gift of ${gift}.`
              : `Cancelled ${donor}'s recurring gift. They won't be charged again.`,
        );
        router.refresh();
      } catch {
        toast.error("We couldn't reach the server. Nothing was changed. Check your connection and try again.");
      }
    });
  };

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {state === "paused" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run("resume")}>
          <Play aria-hidden />
          Resume
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run("pause")}>
          <Pause aria-hidden />
          Pause
        </Button>
      )}
      <Button type="button" variant="ghost" disabled={pending} onClick={() => run("cancel")}>
        <X aria-hidden />
        Cancel
      </Button>
    </div>
  );
}
