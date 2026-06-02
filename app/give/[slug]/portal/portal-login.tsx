"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PortalLogin({
  slug,
  churchName,
}: {
  slug: string;
  churchName: string;
}) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sendLink = () => {
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/give/portal/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email: email.trim() }),
      });
      const data = await res.json();
      setMessage(
        data.message ??
          "If we find gifts for that email, we sent a sign-in link.",
      );
    });
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">{churchName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Donor portal</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Enter the email you use for giving. We&apos;ll send a secure link to manage
        recurring gifts, update your card, and download tax statements.
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
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      <Button
        type="button"
        className="w-full"
        disabled={pending || !email.trim()}
        onClick={sendLink}
      >
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <a href={`/give/${slug}`} className="underline hover:text-foreground">
          ← Back to give
        </a>
      </p>
    </div>
  );
}
