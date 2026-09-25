"use client";

import { useEffect, useState, useTransition } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";

import { submitSupportTicket } from "@/app/dashboard/support/actions";
import {
  SUPPORT_RESPONSE_TIME,
  SUPPORT_SUBJECT_MAX,
  sanitizeFromPath,
} from "@/app/dashboard/support/ticket-helpers";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessState } from "@/components/ui/success-state";
import { Textarea } from "@/components/ui/textarea";

/** The dashboard page someone came from, when no `?from=` was passed. */
function referrerPath(): string | null {
  try {
    if (!document.referrer) return null;
    const url = new URL(document.referrer);
    if (url.origin !== window.location.origin) return null;
    return sanitizeFromPath(url.pathname);
  } catch {
    return null;
  }
}

export function SupportTicketForm({ fromPath }: { fromPath?: string | null }) {
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [from, setFrom] = useState<string | null>(fromPath ?? null);

  useEffect(() => {
    if (!fromPath) setFrom(referrerPath());
  }, [fromPath]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write a message so we know how to help.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const result = await submitSupportTicket({ subject, body, fromPath: from });
        if (result.error) {
          setError(result.error);
          return;
        }
        setSubject("");
        setBody("");
        setSent(true);
        toast.success("Message sent to FaithForm.");
      } catch {
        setError("We couldn't send your message. Check your connection and try again.");
      }
    });
  };

  if (sent) {
    return (
      <SuccessState
        title="Message sent"
        description={`A person on the FaithForm team will reply by email ${SUPPORT_RESPONSE_TIME}. You can also follow it below under "Your messages".`}
        actions={
          <Button type="button" variant="outline" onClick={() => setSent(false)}>
            Send another message
          </Button>
        }
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="support-body" className="text-base font-semibold">
          Message
        </Label>
        <Textarea
          id="support-body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Tell us what you were trying to do and what happened. For example: I can't find where to add a new family."
          rows={7}
          required
          className="text-base"
        />
        {from && (
          <p className="text-sm text-muted-foreground">
            We&apos;ll include the page you were on, so we can see what you saw.
          </p>
        )}
      </div>

      <AdvancedSection
        title="Add a subject line"
        description="Optional. If you skip it, we use the first line of your message."
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="support-subject" className="text-[15px]">
            Subject
          </Label>
          <Input
            id="support-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="A few words about your question"
            maxLength={SUPPORT_SUBJECT_MAX}
          />
        </div>
      </AdvancedSection>

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" size="lg" disabled={pending}>
          <Send aria-hidden />
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
