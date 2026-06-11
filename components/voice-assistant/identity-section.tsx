"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DENOMINATIONS } from "@/types/voice-assistant";

type IdentitySectionProps = {
  assistantName: string;
  denomination: string;
  churchPhone: string;
  emergencyPhone: string;
  readOnly?: boolean;
  assistantNameRef?: React.RefObject<HTMLInputElement>;
  onChange: (patch: {
    assistantName?: string;
    denomination?: string;
    churchPhone?: string;
    emergencyPhone?: string;
  }) => void;
};

export function IdentitySection({
  assistantName,
  denomination,
  churchPhone,
  emergencyPhone,
  readOnly = false,
  assistantNameRef,
  onChange,
}: IdentitySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="assistant-name">Assistant Name</Label>
          <Input
            id="assistant-name"
            ref={assistantNameRef}
            placeholder="e.g. Grace, Hope, Faith"
            value={assistantName}
            disabled={readOnly}
            onChange={(e) => onChange({ assistantName: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            This is what your AI assistant will call itself.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="denomination">Denomination</Label>
          <Select
            id="denomination"
            value={denomination}
            disabled={readOnly}
            onChange={(e) => onChange({ denomination: e.target.value })}
          >
            <option value="">Select a denomination</option>
            {DENOMINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="church-phone">Church Phone Number</Label>
          <Input
            id="church-phone"
            type="tel"
            placeholder="(555) 123-4567"
            value={churchPhone}
            disabled={readOnly}
            onChange={(e) => onChange({ churchPhone: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Callers will be transferred here if they ask for a real person.
          </p>
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
            Calls about crisis or urgent prayer will transfer here immediately.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
