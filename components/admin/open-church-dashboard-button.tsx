import type { ComponentProps } from "react";
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
  /** A dashboard path to land on, for doors that open onto one page. */
  next,
  label,
  variant,
  size,
}: {
  churchId: string;
  churchName: string;
  next?: string;
  label?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  return (
    <form action={startImpersonation}>
      <input type="hidden" name="churchId" value={churchId} />
      {next && <input type="hidden" name="next" value={next} />}
      <Button type="submit" className="gap-2" variant={variant} size={size}>
        <LogIn className="size-4" aria-hidden />
        {label ?? `Open ${churchName}'s dashboard`}
      </Button>
    </form>
  );
}
