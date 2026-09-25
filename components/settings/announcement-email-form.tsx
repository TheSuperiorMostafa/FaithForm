"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";

import { updateAnnouncementEmailSettings } from "@/app/dashboard/settings/actions";
import type { SettingsFormState } from "@/app/dashboard/settings/actions";
import { ConfirmResetButton } from "@/components/settings/confirm-reset-button";
import { PlaceholderChips } from "@/components/settings/placeholder-chips";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      {pending ? "Saving…" : "Save weekly email"}
    </Button>
  );
}

const SUBJECT_CHIPS = [
  { token: ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER, meaning: "The week's dates" },
];

const BODY_CHIPS = [
  { token: ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events, meaning: "This week's events" },
  { token: ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName, meaning: "Your church's name" },
  { token: ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.week, meaning: "The week's dates" },
];

export function AnnouncementEmailForm({
  template,
  isAdmin,
}: {
  template: AnnouncementEmailTemplate;
  isAdmin: boolean;
}) {
  const [weeklyEmailEnabled, setWeeklyEmailEnabled] = useState(template.weeklyEmailEnabled);
  const [state, formAction] = useActionState<SettingsFormState, FormData>(
    updateAnnouncementEmailSettings,
    { ok: false },
  );

  useEffect(() => {
    if (state.ok) toast.success("Weekly email settings saved.");
  }, [state]);

  // A reset turns the Monday draft back on; keep the switch in step.
  useEffect(() => {
    setWeeklyEmailEnabled(template.weeklyEmailEnabled);
  }, [template.weeklyEmailEnabled]);

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly announcement email</CardTitle>
        <CardDescription className="text-[15px]">
          Every Monday, FaithForm writes a draft email listing this week&apos;s events. It waits
          in your email&apos;s Drafts folder, so nothing is sent until you send it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Keyed on the saved template so a reset shows the default wording. */}
        <form
          key={`${template.subject}\n${template.body}\n${template.to ?? ""}`}
          action={formAction}
          className="flex flex-col gap-5"
        >
          <input
            type="hidden"
            name="weekly_email_enabled"
            value={weeklyEmailEnabled ? "true" : "false"}
          />
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border p-5">
            <div className="space-y-1">
              <Label htmlFor="weekly_email_enabled" className="text-base font-semibold">
                Write a draft every Monday
              </Label>
              <p className="text-[15px] text-muted-foreground">
                {weeklyEmailEnabled
                  ? "On. A new draft appears each Monday."
                  : "Off. No drafts are written."}
              </p>
            </div>
            <Switch
              id="weekly_email_enabled"
              checked={weeklyEmailEnabled}
              onCheckedChange={setWeeklyEmailEnabled}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="announcement_email_to" className="text-[15px]">
              Address the draft to <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="announcement_email_to"
              name="announcement_email_to"
              type="email"
              defaultValue={template.to ?? ""}
              placeholder="team@yourchurch.org"
            />
            <p className="text-sm text-muted-foreground">
              Leave empty to choose who gets it each week.
            </p>
          </div>

          <AdvancedSection
            title="Change the email's wording"
            description="The subject line and the message around your events."
            forceOpen={Boolean(state.error)}
          >
            <div className="flex flex-col gap-3">
              <Label htmlFor="announcement_email_subject" className="text-[15px]">
                Subject line
              </Label>
              <Input
                id="announcement_email_subject"
                name="announcement_email_subject"
                defaultValue={template.subject}
                placeholder={DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT}
                required
              />
              <PlaceholderChips
                chips={SUBJECT_CHIPS}
                targetId="announcement_email_subject"
                label="Must include the week's dates. Tap to add it:"
              />
            </div>

            <div className="flex flex-col gap-3">
              <Label htmlFor="announcement_email_body" className="text-[15px]">
                Message
              </Label>
              <Textarea
                id="announcement_email_body"
                name="announcement_email_body"
                defaultValue={template.body}
                placeholder={DEFAULT_ANNOUNCEMENT_EMAIL_BODY}
                rows={10}
                required
              />
              <PlaceholderChips
                chips={BODY_CHIPS}
                targetId="announcement_email_body"
                label="FaithForm fills these in each week. The message must include this week's events. Tap to add:"
              />
              <p className="text-sm leading-relaxed text-muted-foreground">
                Write in plain text; your line breaks are kept. Web addresses become links on their
                own. Each event&apos;s date, time and place are laid out for you.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                To show your own words for a link, put the words in square brackets and the web
                address straight after in round brackets:{" "}
                <span className="font-mono text-foreground">[Sign up](https://example.org)</span>
              </p>
            </div>
          </AdvancedSection>

          {state.error && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
              {state.error}
            </p>
          )}
          {state.ok && (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
              Weekly email settings saved.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <SaveButton />
            <ConfirmResetButton
              title="Go back to FaithForm's wording?"
              description="Your subject line and message are replaced with our standard wording, the Monday draft is turned on, and the address is cleared. This can't be undone."
              confirmLabel="Reset weekly email"
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
