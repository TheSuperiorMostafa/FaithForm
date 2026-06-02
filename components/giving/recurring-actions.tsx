"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { GivingSubscriptionRow } from "@/types/giving";

export function RecurringActions({
  subscription,
}: {
  subscription: GivingSubscriptionRow;
}) {
  const [pending, startTransition] = useTransition();

  const callAction = (action: "pause" | "resume" | "cancel") => {
    if (action === "cancel") {
      const ok = window.confirm(
        "Cancel this recurring gift? The donor will not be charged again.",
      );
      if (!ok) return;
    }

    startTransition(async () => {
      await fetch(`/api/dashboard/giving/subscriptions/${subscription.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      window.location.reload();
    });
  };

  if (subscription.status === "canceled") {
    return <span className="text-xs text-muted-foreground">Canceled</span>;
  }

  const isPaused = subscription.status === "paused" || subscription.pausedAt;

  return (
    <div className="flex flex-wrap gap-1">
      {isPaused ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => callAction("resume")}
        >
          Resume
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => callAction("pause")}
        >
          Pause
        </Button>
      )}
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => callAction("cancel")}
      >
        Cancel
      </Button>
    </div>
  );
}
