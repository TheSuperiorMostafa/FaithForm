"use client";

import Link from "next/link";
import { useState, useTransition, type ComponentProps, type FormEvent } from "react";
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
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(false);
    startTransition(async () => {
      try {
        await startImpersonation(formData);
      } catch {
        // An expired session is rejected by middleware before the action runs.
        // Keep the control available and explain the next step in this page.
        setError(true);
      }
    });
  }

  return (
    <form action={startImpersonation} onSubmit={handleSubmit}>
      <input type="hidden" name="churchId" value={churchId} />
      {next && <input type="hidden" name="next" value={next} />}
      <Button type="submit" className="gap-2" variant={variant} size={size} disabled={pending}>
        <LogIn className="size-4" aria-hidden />
        {pending ? "Opening church…" : label ?? `Open ${churchName}'s dashboard`}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Couldn&apos;t open this church. Your admin session may have ended. {" "}
          <Link href="/login" className="underline underline-offset-2">Sign in again</Link> and retry.
        </p>
      )}
    </form>
  );
}
