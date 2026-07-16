"use client";

import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoiceAssistantFieldErrors } from "@/lib/utils/voice-assistant-validation";
import type { VoiceProfileSummary } from "@/types/voice-assistant";

type AvailabilitySectionProps = {
  profile: VoiceProfileSummary;
  afterHoursEnabled: boolean;
  afterHoursMessage: string;
  readOnly?: boolean;
  errors?: VoiceAssistantFieldErrors;
  showErrors?: boolean;
  onChange: (patch: {
    afterHoursEnabled?: boolean;
    afterHoursMessage?: string;
  }) => void;
};

export function AvailabilitySection({
  profile,
  afterHoursEnabled,
  afterHoursMessage,
  readOnly = false,
  errors,
  showErrors = false,
  onChange,
}: AvailabilitySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability</CardTitle>
        <p className="text-sm text-muted-foreground">
          Office hours live in Church Profile. Configure after-hours behavior here.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="space-y-2">
          <Label>Office hours</Label>
          <p className="rounded-[10px] border border-border bg-muted/30 px-3 py-2 text-sm">
            {profile.hasOpenOfficeDay
              ? "Office hours configured in Church Profile."
              : "Not configured yet."}
          </p>
          <p className="text-xs text-muted-foreground">
            Update in{" "}
            <Link href="/dashboard/church-profile" className="font-medium text-accent underline">
              Church Profile → Service information
            </Link>
            .
          </p>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="after-hours-mode">After-Hours Mode</Label>
              <p className="text-xs text-muted-foreground">
                Play a special message when your office is closed.
              </p>
            </div>
            <Switch
              id="after-hours-mode"
              checked={afterHoursEnabled}
              disabled={readOnly}
              onCheckedChange={(checked) => onChange({ afterHoursEnabled: checked })}
            />
          </div>

          {afterHoursEnabled && (
            <div className="space-y-2">
              <Label htmlFor="after-hours-message">
                After-Hours Message <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="after-hours-message"
                placeholder="Our office is currently closed. We're open Monday–Friday 9am–5pm. Please leave a message."
                value={afterHoursMessage}
                disabled={readOnly}
                aria-invalid={showErrors && Boolean(errors?.afterHoursMessage)}
                onChange={(e) => onChange({ afterHoursMessage: e.target.value })}
              />
              {showErrors && errors?.afterHoursMessage ? (
                <p className="text-xs text-destructive">
                  {errors.afterHoursMessage}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
