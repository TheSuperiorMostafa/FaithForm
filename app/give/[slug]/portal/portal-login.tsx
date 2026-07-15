"use client";

import { useState, useTransition } from "react";
import { GivePageHeader } from "@/components/giving/give-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PortalLogin({
  slug,
  churchName,
  logoUrl,
  initialMessage = null,
  initialIsError = false,
}: {
  slug: string;
  churchName: string;
  logoUrl?: string | null;
  initialMessage?: string | null;
  initialIsError?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [isError, setIsError] = useState(initialIsError);
  const [pending, startTransition] = useTransition();

  const sendLink = () => {
    startTransition(async () => {
      setMessage(null);
      setIsError(false);
      const res = await fetch("/api/give/portal/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email: email.trim() }),
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

      setMessage(
        data.message ?? "Check your email for a link to access the donor portal.",
      );
    });
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <GivePageHeader churchName={churchName} logoUrl={logoUrl} showRateNote={false} />
      <p className="text-center text-sm text-muted-foreground">Donor portal</p>
      <p className="text-sm text-muted-foreground">
        Sign in or create an account with your email. We&apos;ll send a secure link
        to give, manage recurring gifts, update your card, and download tax
        statements.
      </p>
      <div className="space-y-2">
        <Label htmlFor="portal-email">Email</Label>
        <Input
          id="portal-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </div>
      {message && (
        <p
          className={`text-sm ${isError ? "text-destructive" : "text-muted-foreground"}`}
          role="status"
        >
          {message}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={pending || !email.trim()}
        onClick={sendLink}
      >
        {pending ? "Sending…" : "Continue with email"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <a href={`/give/${slug}`} className="underline hover:text-foreground">
          ← Back to give
        </a>
      </p>
    </div>
  );
}
