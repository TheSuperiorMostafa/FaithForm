"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { getFeatureAccess } from "@/lib/features/access";
import { staffPreferencesSchema, STAFF_NOTIFICATION_EVENTS, type StaffPreferences } from "@/lib/notifications/staff-preferences";
import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/sms/phone";
import { toUserError } from "@/lib/errors/user-error";

export async function saveNotificationPreferences(input: StaffPreferences) {
  const [auth, access] = await Promise.all([getChurchAuth(), getFeatureAccess()]);
  if (!auth || auth.impersonation) return { ok: false, error: "Sign in with your church account to change your notifications." };
  const parsed = staffPreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check your notification choices and try again." };
  const preferences = parsed.data;
  const wantsPhone = Object.values(preferences.events).some(value => value.phone);
  const phone = preferences.phone ? toE164(preferences.phone) : null;
  if ((preferences.phone || wantsPhone) && !phone) return { ok: false, error: "Enter a valid mobile number to receive phone notifications." };
  for (const event of STAFF_NOTIFICATION_EVENTS) {
    if (!access?.allowed.includes(event.feature)) preferences.events[event.id] = { email: false, phone: false };
  }
  const { error } = await createAdminClient().from("staff_notification_preferences").upsert({ church_id: auth.churchId, user_id: auth.userId, phone: phone ?? "", events: preferences.events, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: toUserError(error, "We couldn't save your notification choices") };
  revalidatePath("/dashboard/settings");
  return { ok: true as const, preferences: { ...preferences, phone: phone ?? "" } };
}
