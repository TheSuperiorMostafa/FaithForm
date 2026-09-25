"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { syncStripeAccountStatus } from "@/app/dashboard/settings/giving-actions";
import { GIVING_COPY } from "@/components/giving/giving-page-parts";
import { RETURN_TO_KEY } from "@/components/giving/use-bank-connection";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Coming back from the payment partner's onboarding
 * (`/dashboard/giving?stripe_return=1` or `?stripe_refresh=1`, set in
 * lib/stripe/connect.ts).
 *
 * - return:  refresh the bank connection's status now, rather than waiting
 *            for the webhook, then go to the next step.
 * - refresh: the partner's link expired; send the person back to the connect
 *            step to start a fresh one.
 */
export function StripeReturn({ mode, isAdmin }: { mode: "return" | "refresh"; isAdmin: boolean }) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let returnTo: string | null = null;
    try {
      returnTo = sessionStorage.getItem(RETURN_TO_KEY);
      sessionStorage.removeItem(RETURN_TO_KEY);
    } catch {
      returnTo = null;
    }
    const fromSettings = returnTo === "settings";
    const connectStep = fromSettings ? "/dashboard/giving/settings" : "/dashboard/giving?step=connect";

    if (mode === "refresh" || !isAdmin) {
      if (mode === "refresh") {
        toast.info("That page timed out. Choose Connect your bank to carry on where you left off.");
      }
      router.replace(connectStep);
      return;
    }

    void (async () => {
      try {
        const result = await syncStripeAccountStatus();
        if (result.error) {
          toast.error(result.error);
          router.replace(connectStep);
          return;
        }
        if (result.chargesEnabled) {
          toast.success("Your bank is connected. Your church can receive gifts.");
          router.replace(fromSettings ? "/dashboard/giving/settings" : "/dashboard/giving?step=funds");
          return;
        }
        toast.info("Thanks. A few details are still being checked. We'll show what's left.");
        router.replace(connectStep);
      } catch {
        toast.error("We couldn't check your bank connection. Choose Check again to try once more.");
        router.replace(connectStep);
      }
    })();
  }, [isAdmin, mode, router]);

  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={GIVING_COPY.overview.title} description={GIVING_COPY.overview.description} />
      <Card className="flex items-center gap-4 p-6" role="status" aria-live="polite">
        <Loader2 className="size-6 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        <p className="text-base font-semibold text-foreground">
          {mode === "refresh" ? "Taking you back to your bank connection…" : "Checking your bank connection…"}
        </p>
      </Card>
    </div>
  );
}
