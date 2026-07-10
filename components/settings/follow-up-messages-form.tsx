"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  updateFollowUpMessages,
  type SettingsFormState,
} from "@/app/dashboard/settings/actions";
import {
  FOLLOW_UP_TEMPLATE_COUNT,
  FOLLOW_UP_TEMPLATE_LABELS,
  pickFollowUpMessage,
} from "@/lib/sms/follow-up-messages";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save messages"}
    </Button>
  );
}

function ResetButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="reset"
      value="1"
      variant="outline"
      formNoValidate
      disabled={pending}
    >
      Reset to defaults
    </Button>
  );
}

export function FollowUpMessagesForm({
  templates,
  isAdmin,
}: {
  templates: string[];
  isAdmin: boolean;
}) {
  const [state, formAction] = useFormState<SettingsFormState, FormData>(
    updateFollowUpMessages,
    { ok: false },
  );

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Only church admins can edit attendance follow-up messages. Messages
          are sent automatically when you submit attendance with follow-up
          checked for absent members.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance follow-up messages</CardTitle>
        <p className="text-sm text-muted-foreground">
          Customize the five SMS templates sent when you follow up with absent
          members. Use{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">[Name]</code>{" "}
          for the member&apos;s first name. The message escalates based on
          consecutive absences (1st miss through 5th+).
        </p>
      </CardHeader>
      <CardContent>
        <form
          key={templates.join("\n")}
          action={formAction}
          className="flex flex-col gap-5"
        >
          {Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, (_, index) => {
            const template = templates[index] ?? "";
            const preview = pickFollowUpMessage("Alex", index + 1, templates);

            return (
              <div key={index} className="grid gap-2">
                <Label htmlFor={`message_${index}`}>
                  Message {index + 1}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({FOLLOW_UP_TEMPLATE_LABELS[index]})
                  </span>
                </Label>
                <Textarea
                  id={`message_${index}`}
                  name={`message_${index}`}
                  defaultValue={template}
                  rows={3}
                  maxLength={480}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Preview: {preview}
                </p>
              </div>
            );
          })}

          {state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          {state.ok ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              Follow-up messages saved.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <SaveButton />
            <ResetButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
