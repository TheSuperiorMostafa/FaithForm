"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateAnnouncementEmailSettings } from "@/app/dashboard/settings/actions";
import type { SettingsFormState } from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS,
  ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER,
  DEFAULT_ANNOUNCEMENT_EMAIL_BODY,
  DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT,
  type AnnouncementEmailTemplate,
} from "@/lib/email/announcement-template";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save email template"}
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

export function AnnouncementEmailForm({
  template,
  isAdmin,
}: {
  template: AnnouncementEmailTemplate;
  isAdmin: boolean;
}) {
  const [weeklyEmailEnabled, setWeeklyEmailEnabled] = useState(
    template.weeklyEmailEnabled,
  );
  const [state, formAction] = useFormState<SettingsFormState, FormData>(
    updateAnnouncementEmailSettings,
    { ok: false },
  );

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Only church admins can edit the weekly announcement email template.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly announcement email</CardTitle>
        <p className="text-sm text-muted-foreground">
          FaithForm creates one Gmail draft every Monday with this week&apos;s
          upcoming events. Use placeholders:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER}
          </code>
          ,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName}
          </code>
          , and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events}
          </code>
          . Write plain text — your line breaks are kept, and each event&apos;s
          date, time, and location are formatted for you where{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events}
          </code>{" "}
          appears. Web addresses become links on their own; to give a link your
          own wording, write{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            [Register here](https://example.org/signup)
          </code>
          .
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <input
            type="hidden"
            name="weekly_email_enabled"
            value={weeklyEmailEnabled ? "true" : "false"}
          />
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <Label htmlFor="weekly_email_enabled" className="font-semibold">
                Monday Gmail drafts
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically queue one draft each Monday for the current week.
              </p>
            </div>
            <Switch
              id="weekly_email_enabled"
              checked={weeklyEmailEnabled}
              onCheckedChange={setWeeklyEmailEnabled}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="announcement_email_to">Default recipient (optional)</Label>
            <Input
              id="announcement_email_to"
              name="announcement_email_to"
              type="email"
              defaultValue={template.to ?? ""}
              placeholder="team@yourchurch.org"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="announcement_email_subject">Subject</Label>
            <Input
              id="announcement_email_subject"
              name="announcement_email_subject"
              defaultValue={template.subject}
              placeholder={DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="announcement_email_body">Body</Label>
            <Textarea
              id="announcement_email_body"
              name="announcement_email_body"
              defaultValue={template.body}
              placeholder={DEFAULT_ANNOUNCEMENT_EMAIL_BODY}
              rows={10}
              required
            />
          </div>

          {state.error && (
            <p className="text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state.ok && (
            <p className="text-sm text-green-700 dark:text-green-300" role="status">
              Email template saved.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <SaveButton />
            <ResetButton />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
