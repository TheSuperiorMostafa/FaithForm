"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  saveChurchProfile,
  uploadChurchCoverImage,
  uploadChurchProfileLogo,
} from "@/app/dashboard/church-profile/actions";
import { TimezoneSelect } from "@/components/admin/timezone-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColorPickerField } from "@/components/ui/color-picker-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { normalizeHexColor } from "@/lib/giving/branding";
import {
  AI_KNOWLEDGE_FIELDS,
  DAY_OF_WEEK_LABELS,
  newServiceTimeRow,
  newStaffRow,
  SERVICE_TIME_KINDS,
  type ChurchProfileFormState,
} from "@/types/church-profile";
import { DENOMINATIONS } from "@/types/voice-assistant";
import type { DayHours, DayKey, OfficeHours } from "@/types/voice-assistant";

const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

type ChurchProfileFormProps = {
  initialForm: ChurchProfileFormState;
  isAdmin: boolean;
};

function updateDay(
  hours: OfficeHours,
  day: DayKey,
  patch: Partial<DayHours>,
): OfficeHours {
  return { ...hours, [day]: { ...hours[day], ...patch } };
}

const DEFAULT_PRIMARY_COLOR = "#1A2B4B";
const DEFAULT_ACCENT_COLOR = "#C19A6B";

function formsEqual(a: ChurchProfileFormState, b: ChurchProfileFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ChurchProfileForm({ initialForm, isAdmin }: ChurchProfileFormProps) {
  const [form, setForm] = useState(initialForm);
  const [baseline, setBaseline] = useState(initialForm);
  const [showErrors, setShowErrors] = useState(false);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm(initialForm);
    setBaseline(initialForm);
    setShowErrors(false);
  }, [initialForm]);

  const isDirty = !formsEqual(form, baseline);

  const errors = useMemo(() => {
    const next: Partial<Record<string, string>> = {};
    if (form.name.trim().length < 2) next.name = "Church name is required.";
    if (!form.denomination.trim()) next.denomination = "Select a denomination.";
    if (form.phone.trim() && form.phone.replace(/\D/g, "").length < 10) {
      next.phone = "Enter a valid phone number.";
    }
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      next.email = "Enter a valid email address.";
    }
    if (!Object.values(form.officeHours).some((d) => d.enabled)) {
      next.officeHours = "Enable at least one office day.";
    }
    return next;
  }, [form]);

  const patch = (next: Partial<ChurchProfileFormState>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const handleLogoUpload = async (file: File) => {
    const fd = new FormData();
    fd.set("logo", file);
    const result = await uploadChurchProfileLogo(fd);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    patch({ logoUrl: result.logoUrl });
    toast.success("Logo uploaded.");
  };

  const handleCoverUpload = async (file: File) => {
    const fd = new FormData();
    fd.set("cover", file);
    const result = await uploadChurchCoverImage(fd);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    patch({ coverImageUrl: result.coverUrl });
    toast.success("Cover image uploaded.");
  };

  const handleSave = () => {
    if (!isAdmin) return;
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      toast.error("Complete the required fields before saving.");
      nameRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const result = await saveChurchProfile(form);
      if (!("ok" in result) || !result.ok) {
        toast.error("error" in result ? result.error : "Could not save profile.");
        return;
      }
      setBaseline(form);
      setShowErrors(false);
      toast.success("Church profile saved.");
    });
  };

  const readOnly = !isAdmin;
  const previewPrimary =
    normalizeHexColor(form.primaryColor) ?? DEFAULT_PRIMARY_COLOR;
  const previewAccent =
    normalizeHexColor(form.accentColor) ?? DEFAULT_ACCENT_COLOR;

  return (
    <div className="flex flex-col gap-6 pb-28">
      {!isAdmin && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            You can view your church profile. Only admins can make changes.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <p className="text-sm text-muted-foreground">
            Name, visual identity, and brand colors used across giving, posters, and live.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="church-name">
              Church name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="church-name"
              ref={nameRef}
              value={form.name}
              disabled={readOnly}
              aria-invalid={showErrors && Boolean(errors.name)}
              onChange={(e) => patch({ name: e.target.value })}
            />
            {showErrors && errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tagline">Tagline</Label>
            <Input
              id="tagline"
              placeholder="e.g. A place to belong, believe, and become"
              value={form.tagline}
              disabled={readOnly}
              onChange={(e) => patch({ tagline: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="mission">Mission statement</Label>
              <Textarea
                id="mission"
                rows={3}
                value={form.missionStatement}
                disabled={readOnly}
                onChange={(e) => patch({ missionStatement: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vision">Vision statement</Label>
              <Textarea
                id="vision"
                rows={3}
                value={form.visionStatement}
                disabled={readOnly}
                onChange={(e) => patch({ visionStatement: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">About your church</Label>
            <Textarea
              id="description"
              rows={4}
              value={form.description}
              disabled={readOnly}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Logo</Label>
              {form.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.logoUrl}
                  alt="Church logo"
                  className="h-20 w-20 rounded-lg border border-border object-contain"
                />
              ) : (
                <p className="text-sm text-muted-foreground">No logo uploaded.</p>
              )}
              {!readOnly && (
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleLogoUpload(file);
                  }}
                />
              )}
            </div>
            <div className="space-y-2">
              <Label>Cover image</Label>
              {form.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.coverImageUrl}
                  alt="Church cover"
                  className="h-24 w-full max-w-xs rounded-lg border border-border object-cover"
                />
              ) : (
                <p className="text-sm text-muted-foreground">No cover image.</p>
              )}
              {!readOnly && (
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleCoverUpload(file);
                  }}
                />
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ColorPickerField
              id="primary-color"
              label="Primary brand color"
              value={form.primaryColor}
              defaultColor={DEFAULT_PRIMARY_COLOR}
              disabled={readOnly}
              onChange={(primaryColor) => patch({ primaryColor })}
            />
            <ColorPickerField
              id="accent-color"
              label="Accent color"
              value={form.accentColor}
              defaultColor={DEFAULT_ACCENT_COLOR}
              disabled={readOnly}
              onChange={(accentColor) => patch({ accentColor })}
            />
          </div>

          <div
            className="rounded-lg border border-border p-4"
            style={{
              backgroundColor: `${previewPrimary}14`,
              borderColor: `${previewAccent}66`,
            }}
          >
            <p className="text-xs text-muted-foreground">Color preview</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                style={{ backgroundColor: previewPrimary }}
              >
                Primary button
              </span>
              <span
                className="rounded-md border px-3 py-1.5 text-sm font-medium"
                style={{ borderColor: previewPrimary, color: previewPrimary }}
              >
                Accent outline
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="address">Street address</Label>
            <Input
              id="address"
              value={form.address}
              disabled={readOnly}
              onChange={(e) => patch({ address: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">City</Label>
            <Input
              id="city"
              value={form.city}
              disabled={readOnly}
              onChange={(e) => patch({ city: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              value={form.state}
              disabled={readOnly}
              onChange={(e) => patch({ state: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zip">ZIP</Label>
            <Input
              id="zip"
              value={form.zip}
              disabled={readOnly}
              onChange={(e) => patch({ zip: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Main phone</Label>
            <Input
              id="phone"
              value={form.phone}
              disabled={readOnly}
              aria-invalid={showErrors && Boolean(errors.phone)}
              onChange={(e) => patch({ phone: e.target.value })}
            />
            {showErrors && errors.phone && (
              <p className="text-xs text-destructive">{errors.phone}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Main email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              disabled={readOnly}
              aria-invalid={showErrors && Boolean(errors.email)}
              onChange={(e) => patch({ email: e.target.value })}
            />
            {showErrors && errors.email && (
              <p className="text-xs text-destructive">{errors.email}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={form.website}
              disabled={readOnly}
              onChange={(e) => patch({ website: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="google-maps">Google Maps link</Label>
            <Input
              id="google-maps"
              value={form.googleMapsUrl}
              disabled={readOnly}
              onChange={(e) => patch({ googleMapsUrl: e.target.value })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Timezone</Label>
            <TimezoneSelect
              value={form.timezone}
              onChange={(tz) => patch({ timezone: tz })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="denomination">
              Denomination <span className="text-destructive">*</span>
            </Label>
            <Select
              id="denomination"
              value={form.denomination}
              disabled={readOnly}
              aria-invalid={showErrors && Boolean(errors.denomination)}
              onChange={(e) => patch({ denomination: e.target.value })}
            >
              <option value="">Select a denomination</option>
              {DENOMINATIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            {showErrors && errors.denomination && (
              <p className="text-xs text-destructive">{errors.denomination}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service information</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-3">
            <Label>Regular service times</Label>
            <div className="flex flex-col gap-3">
              {form.serviceTimes.map((row, index) => (
                <div
                  key={row.clientId}
                  className="grid gap-3 rounded-[10px] border border-border p-3 sm:grid-cols-[1fr_120px_100px_100px_120px_auto]"
                >
                  <Input
                    placeholder="Label"
                    value={row.label}
                    disabled={readOnly}
                    onChange={(e) => {
                      const serviceTimes = [...form.serviceTimes];
                      serviceTimes[index] = { ...row, label: e.target.value };
                      patch({ serviceTimes });
                    }}
                  />
                  <Select
                    value={String(row.dayOfWeek)}
                    disabled={readOnly}
                    onChange={(e) => {
                      const serviceTimes = [...form.serviceTimes];
                      serviceTimes[index] = {
                        ...row,
                        dayOfWeek: Number(e.target.value),
                      };
                      patch({ serviceTimes });
                    }}
                  >
                    {DAY_OF_WEEK_LABELS.map((label, i) => (
                      <option key={label} value={i}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="time"
                    value={row.startTime}
                    disabled={readOnly}
                    onChange={(e) => {
                      const serviceTimes = [...form.serviceTimes];
                      serviceTimes[index] = { ...row, startTime: e.target.value };
                      patch({ serviceTimes });
                    }}
                  />
                  <Input
                    type="time"
                    value={row.endTime}
                    disabled={readOnly}
                    onChange={(e) => {
                      const serviceTimes = [...form.serviceTimes];
                      serviceTimes[index] = { ...row, endTime: e.target.value };
                      patch({ serviceTimes });
                    }}
                  />
                  <Select
                    value={row.kind}
                    disabled={readOnly}
                    onChange={(e) => {
                      const serviceTimes = [...form.serviceTimes];
                      serviceTimes[index] = {
                        ...row,
                        kind: e.target.value as (typeof SERVICE_TIME_KINDS)[number],
                      };
                      patch({ serviceTimes });
                    }}
                  >
                    {SERVICE_TIME_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </Select>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        patch({
                          serviceTimes: form.serviceTimes.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  patch({ serviceTimes: [...form.serviceTimes, newServiceTimeRow()] })
                }
              >
                Add service time
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <Label>
              Office hours <span className="text-destructive">*</span>
            </Label>
            <div
              className={cn(
                "divide-y divide-border rounded-[10px] border border-border",
                showErrors && errors.officeHours && "border-destructive",
              )}
            >
              {DAY_ORDER.map((day) => {
                const row = form.officeHours[day];
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
                        patch({
                          officeHours: updateDay(form.officeHours, day, { enabled }),
                        })
                      }
                    />
                    {row.enabled ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <input
                          type="time"
                          value={row.open}
                          disabled={readOnly}
                          className="min-h-10 rounded-[10px] border-[1.5px] border-border bg-background px-3 text-sm"
                          onChange={(e) =>
                            patch({
                              officeHours: updateDay(form.officeHours, day, {
                                open: e.target.value,
                              }),
                            })
                          }
                        />
                        <span className="text-muted-foreground">to</span>
                        <input
                          type="time"
                          value={row.close}
                          disabled={readOnly}
                          className="min-h-10 rounded-[10px] border-[1.5px] border-border bg-background px-3 text-sm"
                          onChange={(e) =>
                            patch({
                              officeHours: updateDay(form.officeHours, day, {
                                close: e.target.value,
                              }),
                            })
                          }
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
            {showErrors && errors.officeHours && (
              <p className="text-xs text-destructive">{errors.officeHours}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="holiday-schedule">Holiday schedule</Label>
            <Textarea
              id="holiday-schedule"
              rows={3}
              placeholder="Special hours or service changes for holidays"
              value={form.holidaySchedule}
              disabled={readOnly}
              onChange={(e) => patch({ holidaySchedule: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leadership</CardTitle>
          <p className="text-sm text-muted-foreground">
            Staff directory for your website and AI tools. Not the same as congregation members.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {form.staff.map((member, index) => (
            <div
              key={member.clientId}
              className="grid gap-3 rounded-[10px] border border-border p-4 sm:grid-cols-2"
            >
              <div className="space-y-2 sm:col-span-2">
                <Label>Name</Label>
                <Input
                  value={member.fullName}
                  disabled={readOnly}
                  onChange={(e) => {
                    const staff = [...form.staff];
                    staff[index] = { ...member, fullName: e.target.value };
                    patch({ staff });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={member.title}
                  disabled={readOnly}
                  onChange={(e) => {
                    const staff = [...form.staff];
                    staff[index] = { ...member, title: e.target.value };
                    patch({ staff });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={member.phone}
                  disabled={readOnly}
                  onChange={(e) => {
                    const staff = [...form.staff];
                    staff[index] = { ...member, phone: e.target.value };
                    patch({ staff });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={member.email}
                  disabled={readOnly}
                  onChange={(e) => {
                    const staff = [...form.staff];
                    staff[index] = { ...member, email: e.target.value };
                    patch({ staff });
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>AI priority</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={member.aiContactPriority}
                  disabled={readOnly}
                  onChange={(e) => {
                    const staff = [...form.staff];
                    staff[index] = {
                      ...member,
                      aiContactPriority: Number(e.target.value),
                    };
                    patch({ staff });
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={member.isSeniorPastor}
                    disabled={readOnly}
                    onChange={(e) => {
                      const staff = [...form.staff];
                      staff[index] = { ...member, isSeniorPastor: e.target.checked };
                      patch({ staff });
                    }}
                  />
                  Senior pastor
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={member.isPublic}
                    disabled={readOnly}
                    onChange={(e) => {
                      const staff = [...form.staff];
                      staff[index] = { ...member, isPublic: e.target.checked };
                      patch({ staff });
                    }}
                  />
                  Public listing
                </label>
              </div>
              {!readOnly && (
                <div className="sm:col-span-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      patch({ staff: form.staff.filter((_, i) => i !== index) })
                    }
                  >
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ))}
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              onClick={() => patch({ staff: [...form.staff, newStaffRow()] })}
            >
              Add staff member
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Social media</CardTitle>
          <p className="text-sm text-muted-foreground">
            Public profile links. OAuth connections for posting stay in{" "}
            <Link href="/dashboard/settings" className="text-accent underline">
              Settings
            </Link>
            .
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["facebookUrl", "Facebook"],
              ["instagramUrl", "Instagram"],
              ["youtubeUrl", "YouTube"],
              ["tiktokUrl", "TikTok"],
              ["xUrl", "X / Twitter"],
              ["podcastUrl", "Podcast"],
              ["livestreamUrl", "Livestream override"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label>{label}</Label>
              <Input
                value={form[key]}
                disabled={readOnly}
                placeholder="https://"
                onChange={(e) => patch({ [key]: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI knowledge</CardTitle>
          <p className="text-sm text-muted-foreground">
            Shared by your voice assistant, sermon builder, and future tools.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {AI_KNOWLEDGE_FIELDS.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`ai-${field.key}`}>{field.label}</Label>
              <Textarea
                id={`ai-${field.key}`}
                rows={field.rows ?? 2}
                value={form.aiKnowledge[field.key] ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  patch({
                    aiKnowledge: {
                      ...form.aiKnowledge,
                      [field.key]: e.target.value,
                    },
                  })
                }
              />
              <p className="text-xs text-muted-foreground">{field.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              disabled={!isDirty || pending}
              onClick={() => {
                setForm(baseline);
                setShowErrors(false);
              }}
            >
              Discard
            </Button>
            <Button type="button" disabled={pending || !isDirty} onClick={handleSave}>
              {pending ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
