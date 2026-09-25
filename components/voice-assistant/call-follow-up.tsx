"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Phone, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { markCallHandledAction } from "@/app/dashboard/call-log/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { undoToast } from "@/lib/ui/undo-toast";
import { cn } from "@/lib/utils";

/**
 * "Call back": opens the phone's own dialer. Rendered only when the page was
 * given a number this viewer may dial (see `callerContactForViewer`).
 */
export function CallBackButton({
  dial,
  callerLabel,
  size = "default",
  primary = false,
  className,
}: {
  dial: string;
  callerLabel: string;
  size?: "default" | "lg";
  primary?: boolean;
  className?: string;
}) {
  return (
    <a
      href={`tel:${dial}`}
      aria-label={`Call back ${callerLabel}`}
      className={cn(
        buttonVariants({ variant: primary ? "default" : "outline", size }),
        "gap-2",
        className,
      )}
    >
      <Phone aria-hidden className="size-5" />
      Call back
    </a>
  );
}

/**
 * Marks a call handled (it leaves "Needs a call back"), with Undo, or puts a
 * handled call back on the list. Reversible, so no confirmation dialog.
 */
export function MarkHandledButton({
  callId,
  callerLabel,
  handled,
  size = "default",
  primary = false,
  onChange,
}: {
  callId: string;
  callerLabel: string;
  handled: boolean;
  size?: "default" | "lg";
  primary?: boolean;
  /** Optimistic update for lists; the page refreshes either way. */
  onChange?: (handled: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(handled);

  const set = (next: boolean) =>
    new Promise<string | null>((resolve) => {
      startTransition(async () => {
        const result = await markCallHandledAction(callId, next);
        if (!result.ok) {
          resolve(result.error);
          return;
        }
        setCurrent(next);
        onChange?.(next);
        router.refresh();
        resolve(null);
      });
    });

  const handleClick = async () => {
    const next = !current;
    const failed = await set(next);
    if (failed) {
      toast.error(failed);
      return;
    }
    if (next) {
      undoToast(`Call from ${callerLabel} marked handled.`, () => set(false), {
        undoneMessage: `Call from ${callerLabel} is back on the call-back list.`,
      });
    } else {
      toast.success(`Call from ${callerLabel} is back on the call-back list.`);
    }
  };

  return (
    <Button
      type="button"
      variant={primary && !current ? "default" : "outline"}
      size={size}
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? (
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      ) : current ? (
        <RotateCcw aria-hidden className="size-5" />
      ) : (
        <CheckCircle2 aria-hidden className="size-5" />
      )}
      {current ? "Mark as not handled" : "Mark as handled"}
    </Button>
  );
}
