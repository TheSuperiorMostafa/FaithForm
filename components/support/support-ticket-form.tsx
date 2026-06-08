"use client";

import { useState, useTransition } from "react";
import { submitSupportTicket } from "@/app/dashboard/support/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SupportTicketForm() {
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setMessage(null);
      setError(null);
      const result = await submitSupportTicket({ subject, body });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSubject("");
      setBody("");
      setMessage("Your ticket was submitted. Our team will follow up by email.");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Brief summary of your issue"
          required
          maxLength={200}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-body">Details</Label>
        <textarea
          id="support-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Describe what you need help with (optional)"
          rows={5}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending || !subject.trim()}>
        {pending ? "Submitting…" : "Submit ticket"}
      </Button>
    </form>
  );
}
