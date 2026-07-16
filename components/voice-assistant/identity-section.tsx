"use client";

import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoiceAssistantFieldErrors } from "@/lib/utils/voice-assistant-validation";
import type { VoiceProfileSummary } from "@/types/voice-assistant";

type IdentitySectionProps = {
  assistantName: string;
  emergencyPhone: string;
  profile: VoiceProfileSummary;
  readOnly?: boolean;
  errors?: VoiceAssistantFieldErrors;
  showErrors?: boolean;
  assistantNameRef?: React.RefObject<HTMLInputElement>;
  onChange: (patch: {
    assistantName?: string;
    emergencyPhone?: string;
  }) => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function ProfileField({
  label,
  value,
  required,
}: {
  label: string;
  value: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label} {required ? <span className="text-destructive">*</span> : null}
      </Label>
      <p className="rounded-[10px] border border-border bg-muted/30 px-3 py-2 text-sm">
        {value.trim() || "Not set"}
      </p>
      <p className="text-xs text-muted-foreground">
        Managed in{" "}
        <Link href="/dashboard/church-profile" className="font-medium text-accent underline">
          Church Profile
        </Link>
        .
      </p>
    </div>
  );
}

export function IdentitySection({
  assistantName,
  emergencyPhone,
  profile,
  readOnly = false,
  errors,
  showErrors = false,
  assistantNameRef,
  onChange,
}: IdentitySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
        <p className="text-sm text-muted-foreground">
          Who answers the phone, and where callers go when they need a person.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="assistant-name">
            Assistant Name <span className="text-destructive">*</span>
          </Label>
          <Input
            id="assistant-name"
            ref={assistantNameRef}
            placeholder="e.g. Grace, Hope, Faith"
            value={assistantName}
            disabled={readOnly}
            aria-invalid={showErrors && Boolean(errors?.assistantName)}
            onChange={(e) => onChange({ assistantName: e.target.value })}
          />
          {showErrors ? (
            <FieldError message={errors?.assistantName} />
          ) : (
            <p className="text-xs text-muted-foreground">
              This is what your AI assistant will call itself.
            </p>
          )}
        </div>

        <ProfileField
          label="Denomination"
          value={profile.denomination}
          required
        />

        <ProfileField
          label="Church phone (transfer number)"
          value={profile.churchPhone}
          required
        />

        <div className="space-y-2">
          <Label htmlFor="emergency-phone">Emergency Contact Number</Label>
          <Input
            id="emergency-phone"
            type="tel"
            placeholder="(555) 987-6543"
            value={emergencyPhone}
            disabled={readOnly}
            onChange={(e) => onChange({ emergencyPhone: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Optional. Crisis or urgent prayer calls transfer here immediately.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
