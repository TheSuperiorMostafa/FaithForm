"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveNotificationPreferences } from "@/app/dashboard/settings/notification-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_NOTIFICATION_EVENTS, type StaffPreferences } from "@/lib/notifications/staff-preferences";
import type { FeatureKey } from "@/lib/features/catalog";
import { formatUsPhoneDisplay, formatUsPhoneInput, toE164 } from "@/lib/sms/phone";

export function NotificationPreferencesForm({ initial, email, allowedFeatures }: { initial: StaffPreferences; email: string; allowedFeatures: FeatureKey[] }) {
  const [value, setValue] = useState(initial);
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(preferences: StaffPreferences, phoneChanged = false) {
    startTransition(async () => {
      try {
        const result = await saveNotificationPreferences(preferences);
        if (!result.ok || !result.preferences) {
          const message = result.error || "We couldn't save your notification choices. Please try again.";
          if (phoneChanged) setPhoneError(message);
          toast.error(message);
          return;
        }
        setValue(result.preferences);
        setEditingPhone(false);
        setPhoneError(null);
        toast.success(phoneChanged ? "Your mobile number and notification choices were saved." : "Your notification choices were saved.");
      } catch {
        const message = "We couldn't save your notification choices. Please try again.";
        if (phoneChanged) setPhoneError(message);
        toast.error(message);
      }
    });
  }

  function savePhone() {
    if (phoneDraft.trim() && !toE164(phoneDraft)) {
      setPhoneError("Enter a valid mobile number, including the area code.");
      return;
    }
    save({ ...value, phone: phoneDraft.trim() }, true);
  }

  return <Card><CardHeader><CardTitle>Your notifications</CardTitle><CardDescription>Choose the emails and text messages you receive for this church. These choices affect your account.</CardDescription></CardHeader>
    <CardContent><form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); if (editingPhone) savePhone(); else save(value); }}>
      <p className="text-[15px] text-muted-foreground">Email notifications go to {email}.</p>
      <section className="flex flex-col gap-3" aria-labelledby="notification-phone-label">
        <p id="notification-phone-label" className="text-[15px] font-medium">Your mobile number</p>
        {editingPhone ? <>
          <Input
            aria-labelledby="notification-phone-label"
            aria-invalid={Boolean(phoneError)}
            aria-describedby={phoneError ? "notification-phone-error" : undefined}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="555-123-4567"
            value={phoneDraft}
            onChange={event => { setPhoneDraft(formatUsPhoneInput(event.target.value)); setPhoneError(null); }}
            disabled={pending}
          />
          {phoneError && <p id="notification-phone-error" className="text-sm text-destructive" role="alert">{phoneError}</p>}
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={savePhone} disabled={pending}>{pending ? "Saving…" : "Save mobile number"}</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => { setEditingPhone(false); setPhoneError(null); }}>Cancel</Button>
          </div>
        </> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border p-4">
          <p className="text-[15px]" role="status">{formatUsPhoneDisplay(value.phone) ?? "No mobile number saved"}</p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => {
            setPhoneDraft(formatUsPhoneDisplay(value.phone) ?? "");
            setPhoneError(null);
            setEditingPhone(true);
          }}>{value.phone ? "Edit mobile number" : "Add mobile number"}</Button>
        </div>}
      </section>
      {STAFF_NOTIFICATION_EVENTS.filter(event => allowedFeatures.includes(event.feature)).map(event => <fieldset key={event.id} disabled={pending} className="rounded-2xl border border-border p-5"><legend className="px-1 font-semibold">{event.label}</legend>
        <p className="text-[15px] text-muted-foreground">{event.description}</p>
        <div className="mt-3 flex flex-wrap gap-6">{(["email", "phone"] as const).map(channel => <label key={channel} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-primary" checked={value.events[event.id][channel]} onChange={e => setValue({ ...value, events: { ...value.events, [event.id]: { ...value.events[event.id], [channel]: e.target.checked } } })} />{channel === "email" ? "Email" : "Phone (text message)"}</label>)}</div>
      </fieldset>)}
      <p className="text-sm text-muted-foreground">Text messages use your church&apos;s connected texting phone. Guardian app alerts remain available to guardians.</p>
      <Button type="submit" disabled={pending || editingPhone} className="self-start">{pending ? "Saving…" : "Save notification choices"}</Button>
    </form></CardContent></Card>;
}
