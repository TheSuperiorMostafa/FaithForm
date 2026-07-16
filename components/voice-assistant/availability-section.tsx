"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DayHours, DayKey, OfficeHours } from "@/types/voice-assistant";
import type { VoiceAssistantFieldErrors } from "@/lib/utils/voice-assistant-validation";
import { cn } from "@/lib/utils";

const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

type AvailabilitySectionProps = {
  officeHours: OfficeHours;
  afterHoursEnabled: boolean;
  afterHoursMessage: string;
  readOnly?: boolean;
  errors?: VoiceAssistantFieldErrors;
  showErrors?: boolean;
  onChange: (patch: {
    officeHours?: OfficeHours;
    afterHoursEnabled?: boolean;
    afterHoursMessage?: string;
  }) => void;
};

function updateDay(
  hours: OfficeHours,
  day: DayKey,
  patch: Partial<DayHours>,
): OfficeHours {
  return { ...hours, [day]: { ...hours[day], ...patch } };
}

export function AvailabilitySection({
  officeHours,
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
          Set when staff are reachable and what callers hear after hours.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="space-y-3">
          <Label>
            Office Hours <span className="text-destructive">*</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            Enable at least one open day. Calls outside these hours can use your
            after-hours message.
          </p>
          <div
            className={cn(
              "divide-y divide-border rounded-[10px] border border-border",
              showErrors && errors?.officeHours && "border-destructive",
            )}
          >
            {DAY_ORDER.map((day) => {
              const row = officeHours[day];
              return (
                <div
                  key={day}
                  className="grid grid-cols-[7.25rem_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3"
                >
                  <span className="text-sm font-medium">{DAY_LABELS[day]}</span>
                  <Switch
                    checked={row.enabled}
                    disabled={readOnly}
                    onCheckedChange={(enabled) =>
                      onChange({ officeHours: updateDay(officeHours, day, { enabled }) })
                    }
                    aria-label={`${DAY_LABELS[day]} enabled`}
                  />
                  {row.enabled ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <input
                        type="time"
                        value={row.open}
                        disabled={readOnly}
                        className="min-h-10 rounded-[10px] border-[1.5px] border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        onChange={(e) =>
                          onChange({
                            officeHours: updateDay(officeHours, day, {
                              open: e.target.value,
                            }),
                          })
                        }
                      />
                      <span className="text-sm text-muted-foreground">to</span>
                      <input
                        type="time"
                        value={row.close}
                        disabled={readOnly}
                        className="min-h-10 rounded-[10px] border-[1.5px] border-border bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        onChange={(e) =>
                          onChange({
                            officeHours: updateDay(officeHours, day, {
                              close: e.target.value,
                            }),
                          })
                        }
                      />
                    </div>
                  ) : (
                    <span className="justify-self-end text-sm text-muted-foreground">
                      Closed
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {showErrors && errors?.officeHours && (
            <p className="text-xs text-destructive">{errors.officeHours}</p>
          )}
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
