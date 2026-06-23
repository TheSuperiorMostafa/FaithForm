"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { giveLinkAccent } from "@/components/giving/give-branded-styles";
import { Button } from "@/components/ui/button";

export function ThankYouPortalCta({
  slug,
  email,
}: {
  slug: string;
  email?: string | null;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  const sendPortalLink = () => {
    if (!email) return;

    startTransition(async () => {
      setMessage(null);
      setIsError(false);
      const res = await fetch("/api/give/portal/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setIsError(true);
        setMessage(
          data.error ??
            "We couldn't send the email right now. Please try again in a few minutes.",
        );
        return;
      }

      setMessage(data.message ?? "Check your email for a link to the donor portal.");
    });
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-lg border border-border bg-muted/30 p-4 text-left">
      <div className="space-y-1 text-center">
        <h2 className="font-heading text-base font-semibold">Manage your gifts</h2>
        <p className="text-sm text-muted-foreground">
          Access your donor portal to manage recurring gifts, update your card, and
          download tax statements.
        </p>
      </div>
      <Link
        href={`/give/${slug}/portal`}
        className={giveLinkAccent(
          "flex h-10 w-full items-center justify-center rounded-md border border-current text-sm font-semibold hover:underline",
        )}
      >
        Open donor portal
      </Link>
      {email && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={sendPortalLink}
        >
          {pending ? "Sending…" : "Email me a portal link"}
        </Button>
      )}
      {message && (
        <p
          className={`text-center text-sm ${isError ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
        >
          {message}
        </p>
      )}
    </div>
  );
}
