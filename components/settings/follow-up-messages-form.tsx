"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import {
  updateFollowUpMessages,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions";
import { ConfirmResetButton } from "@/components/settings/confirm-reset-button";
import { PlaceholderChips } from "@/components/settings/placeholder-chips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FOLLOW_UP_TEMPLATE_COUNT,
  FOLLOW_UP_TEMPLATE_LABELS,
  pickFollowUpMessage,
} from "@/lib/sms/follow-up-messages";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save text messages"}
    </Button>
  );
}

const NAME_CHIP = [{ token: "[Name]", meaning: "Their first name" }];

/** The words each absence sends, and a live example of how it will read. */
export function FollowUpMessagesForm({
  templates,
  isAdmin,
}: {
  templates: string[];
  isAdmin: boolean;
}) {
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateFollowUpMessages,
    { ok: false },
  );
  const [drafts, setDrafts] = useState<string[]>(templates);

  useEffect(() => {
    setDrafts(templates);
  }, [templates]);

  useEffect(() => {
    if (state.ok) toast.success("Follow-up text messages saved.");
  }, [state]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Follow-up text messages</CardTitle>
        <CardDescription className="text-[15px]">
          When you follow up with someone who missed church, FaithForm texts them one of these.
          The message changes the more Sundays in a row they have missed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={templates.join("\n")} action={formAction} className="flex flex-col gap-6">
          {Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, (_, index) => {
            const id = `message_${index}`;
            const preview = pickFollowUpMessage("Alex", index + 1, drafts);

            return (
              <div key={index} className="flex flex-col gap-3 rounded-2xl border border-border p-5">
                <Label htmlFor={id} className="text-base font-semibold">
                  {FOLLOW_UP_TEMPLATE_LABELS[index]}
                </Label>
                <Textarea
                  id={id}
                  name={id}
                  defaultValue={templates[index] ?? ""}
                  rows={3}
                  maxLength={480}
                  required
                  onChange={(event) => {
                    const value = event.target.value;
                    setDrafts((current) => current.map((row, i) => (i === index ? value : row)));
                  }}
                />
                <PlaceholderChips chips={NAME_CHIP} targetId={id} label="Must include their name. Tap to add it:" />
                <div className="rounded-xl bg-muted/50 px-4 py-3">
                  <p className="text-sm font-semibold text-muted-foreground">How it reads</p>
                  <p className="mt-1 text-[15px] text-foreground">{preview}</p>
                </div>
              </div>
            );
          })}

          {state.error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.ok ? (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
              Follow-up text messages saved.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <SaveButton />
            <ConfirmResetButton
              title="Go back to FaithForm's text messages?"
              description="All five of your follow-up messages are replaced with our standard wording. This can't be undone."
              confirmLabel="Reset text messages"
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
