"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { syncStripeAccountStatus } from "@/app/dashboard/settings/giving-actions";

/**
 * Leaving for the payment partner's onboarding and coming back.
 *
 * The partner always returns to `/dashboard/giving?stripe_return=1`
 * (lib/stripe/connect.ts). When the trip started from Giving settings we
 * remember that for this tab, so the person lands back where they were.
 */
export const RETURN_TO_KEY = "faithform:giving:return-to";

export function useBankConnection() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const connect = (kind: "onboard" | "refresh", returnTo?: "settings") => {
    startTransition(async () => {
      try {
        try {
          if (returnTo) sessionStorage.setItem(RETURN_TO_KEY, returnTo);
          else sessionStorage.removeItem(RETURN_TO_KEY);
        } catch {
          // Storage can be blocked; the person just lands on the Giving page.
        }
        const res = await fetch(`/api/stripe/connect/${kind}`, { method: "POST" });
        const data = (await res.json().catch(() => null)) as { url?: string } | null;
        if (!res.ok || !data?.url) {
          toast.error(
            res.status === 403
              ? "Only church admins can connect the bank account."
              : "We couldn't open the secure bank connection page. Please try again. If it keeps happening, contact FaithForm support.",
          );
          return;
        }
        window.location.assign(data.url);
      } catch {
        toast.error("We couldn't reach the server. Check your internet connection and try again.");
      }
    });
  };

  const checkAgain = (onConnected?: () => void) => {
    startTransition(async () => {
      try {
        const result = await syncStripeAccountStatus();
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(
          result.chargesEnabled
            ? "Your bank is connected. Your church can receive gifts."
            : "Checked. Your bank connection isn't finished yet.",
        );
        if (result.chargesEnabled && onConnected) onConnected();
        else router.refresh();
      } catch {
        toast.error("We couldn't check your bank connection. Please try again.");
      }
    });
  };

  return { pending, connect, checkAgain };
}
