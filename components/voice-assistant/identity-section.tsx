"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DENOMINATIONS } from "@/types/voice-assistant";
import type { VoiceAssistantFieldErrors } from "@/lib/utils/voice-assistant-validation";

type IdentitySectionProps = {
  assistantName: string;
  denomination: string;
  churchPhone: string;
  emergencyPhone: string;
  readOnly?: boolean;
  errors?: VoiceAssistantFieldErrors;
  showErrors?: boolean;
  assistantNameRef?: React.RefObject<HTMLInputElement>;
  onChange: (patch: {
    assistantName?: string;
    denomination?: string;
    churchPhone?: string;
    emergencyPhone?: string;
  }) => void;
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function IdentitySection({
  assistantName,
  denomination,
  churchPhone,
  emergencyPhone,
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

        <div className="space-y-2">
          <Label htmlFor="denomination">
            Denomination <span className="text-destructive">*</span>
          </Label>
          <Select
            id="denomination"
            value={denomination}
            disabled={readOnly}
            aria-invalid={showErrors && Boolean(errors?.denomination)}
            onChange={(e) => onChange({ denomination: e.target.value })}
          >
            <option value="">Select a denomination</option>
            {DENOMINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
          {showErrors && <FieldError message={errors?.denomination} />}
        </div>

        <div className="space-y-2">
          <Label htmlFor="church-phone">
            Church Phone Number <span className="text-destructive">*</span>
          </Label>
          <Input
            id="church-phone"
            type="tel"
            placeholder="(555) 123-4567"
            value={churchPhone}
            disabled={readOnly}
            aria-invalid={showErrors && Boolean(errors?.churchPhone)}
            onChange={(e) => onChange({ churchPhone: e.target.value })}
          />
          {showErrors ? (
            <FieldError message={errors?.churchPhone} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Required for transferring callers who ask for a pastor or staff
              member.
            </p>
          )}
        </div>

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
