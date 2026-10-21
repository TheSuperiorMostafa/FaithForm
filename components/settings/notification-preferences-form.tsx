"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveNotificationPreferences } from "@/app/dashboard/settings/notification-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAFF_NOTIFICATION_EVENTS, type StaffPreferences } from "@/lib/notifications/staff-preferences";
import type { FeatureKey } from "@/lib/features/catalog";

export function NotificationPreferencesForm({ initial, email, allowedFeatures }: { initial: StaffPreferences; email: string; allowedFeatures: FeatureKey[] }) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  return <Card><CardHeader><CardTitle>Your notifications</CardTitle><CardDescription>Choose the emails and text messages you receive for this church. These choices affect your account.</CardDescription></CardHeader>
    <CardContent><form className="flex flex-col gap-6" onSubmit={event => { event.preventDefault(); startTransition(async () => {
      try { const result = await saveNotificationPreferences(value); if (result.ok) toast.success("Your notification choices were saved."); else toast.error(result.error); }
      catch { toast.error("We couldn't save your notification choices. Please try again."); }
    }); }}>
      <p className="text-[15px] text-muted-foreground">Email notifications go to {email}.</p>
      <label className="flex flex-col gap-2 text-[15px] font-medium">Your mobile number<Input type="tel" autoComplete="tel" value={value.phone} onChange={e => setValue({ ...value, phone: e.target.value })} disabled={pending} /></label>
      {STAFF_NOTIFICATION_EVENTS.filter(event => allowedFeatures.includes(event.feature)).map(event => <fieldset key={event.id} disabled={pending} className="rounded-2xl border border-border p-5"><legend className="px-1 font-semibold">{event.label}</legend>
        <p className="text-[15px] text-muted-foreground">{event.description}</p>
        <div className="mt-3 flex flex-wrap gap-6">{(["email", "phone"] as const).map(channel => <label key={channel} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]"><input type="checkbox" className="size-5 accent-primary" checked={value.events[event.id][channel]} onChange={e => setValue({ ...value, events: { ...value.events, [event.id]: { ...value.events[event.id], [channel]: e.target.checked } } })} />{channel === "email" ? "Email" : "Phone (text message)"}</label>)}</div>
      </fieldset>)}
      <p className="text-sm text-muted-foreground">Text messages use your church&apos;s connected texting phone. Guardian app alerts remain available to guardians.</p>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Save notification choices"}</Button>
    </form></CardContent></Card>;
}
