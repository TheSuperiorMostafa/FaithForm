import { LogIn } from "lucide-react";

import { startImpersonation } from "@/app/admin/impersonation-actions";
import { Button } from "@/components/ui/button";

/**
 * The door from the control center into a church's own dashboard.
 *
 * A plain form post rather than a link: stepping into someone's account is a
 * state change, and it should not be something a prefetch, a crawler, or a
 * pasted URL can do on its own.
 */
export function OpenChurchDashboardButton({
  churchId,
  churchName,
}: {
  churchId: string;
  churchName: string;
}) {
  return (
    <form action={startImpersonation}>
      <input type="hidden" name="churchId" value={churchId} />
      <Button type="submit" className="gap-2">
        <LogIn className="size-4" aria-hidden />
        Open {churchName}&apos;s dashboard
      </Button>
    </form>
  );
}
