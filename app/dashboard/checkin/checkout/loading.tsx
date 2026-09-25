import { ScanLine, ShieldAlert } from "lucide-react";

import { PICKUP_INPUT_LABEL } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Pick up opens on two cards whose words never change, so everything here is
 * real text in the same boxes; nothing is data. It only holds the space so
 * the page doesn't jump when the console arrives.
 */
export default function CheckoutLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="pick up">
      <Card className="flex flex-col gap-4 p-6 sm:p-8">
        <p className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <ScanLine className="size-6" aria-hidden />
          {PICKUP_INPUT_LABEL}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex min-h-16 w-full flex-1 items-center rounded-2xl border-2 border-border bg-background px-5 py-4 font-mono text-2xl tracking-[0.15em] text-muted-foreground/60 shadow-sm">
            123 456
          </div>
          <div className="inline-flex min-h-16 items-center justify-center rounded-[10px] bg-accent px-7 text-base font-semibold text-accent-foreground opacity-50">
            Find family
          </div>
        </div>
        <p className="text-[15px] text-muted-foreground">
          A handheld scanner fills this in for you. Codes change every week, so
          last week&rsquo;s code won&rsquo;t work.
        </p>
      </Card>

      <Card className="flex flex-col gap-4 p-6 sm:p-8">
        <div className="space-y-1">
          <p className="font-heading text-xl font-bold text-foreground">No phone, no code?</p>
          <p className="text-[15px] text-muted-foreground">
            Find the family by name, check the adult&rsquo;s ID yourself, and
            write down what you checked. Every release like this is flagged for
            review.
          </p>
        </div>
        <div className="inline-flex min-h-12 items-center gap-2 self-start rounded-[10px] border border-primary/45 px-7 text-base font-semibold text-primary opacity-50 dark:border-accent/60 dark:text-accent">
          <ShieldAlert className="size-5" aria-hidden />
          Release without a code
        </div>
      </Card>
    </SkeletonContainer>
  );
}
