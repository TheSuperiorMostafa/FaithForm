import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function TextAppCheckContent({ children }: { children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <h2 className="font-heading text-xl font-bold">Open your SMS Mobile API app to make sure all texts send through properly</h2>
        <p className="text-base text-muted-foreground">Check the sending phone for waiting or failed messages. Resolve any issues, then hold the button below for 3 seconds to confirm you completed this check.</p>
        <p className="text-sm text-muted-foreground">Your confirmation records this check. Delivery status updates when the phone confirms each text was sent. Each confirmed text adds an estimated 2 minutes saved to your time tracker.</p>
        {children ?? <span aria-hidden className="flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground">Hold for 3 seconds to confirm</span>}
      </CardContent>
    </Card>
  );
}
