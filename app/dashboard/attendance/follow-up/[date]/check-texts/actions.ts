"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileAttendanceTexts } from "@/lib/attendance/sms-delivery";
import { isValidDateParam } from "@/lib/utils/dates";

export async function confirmTextAppCheck(serviceDate: string, through: string) {
  const supabase = createClient();
  const denied = await featureActionError("attendance_follow_up", supabase);
  if (denied) return { ok: false as const, error: denied };
  const auth = await getChurchAuth(supabase);
  if (!auth) return { ok: false as const, error: "You must be signed in." };
  if (!isValidDateParam(serviceDate) || !Number.isFinite(Date.parse(through)) || Date.parse(through) > Date.now()) {
    return { ok: false as const, error: "Open the text check page again and try once more." };
  }
  const admin = createAdminClient();
  try {
    // A person's confirmation records their app check. Provider confirmation
    // separately controls delivery status and time credit.
    await reconcileAttendanceTexts(admin, auth.churchId, serviceDate);
    const { error } = await admin.from("attendance_follow_up_log")
      .update({ app_checked_at: new Date().toISOString(), app_checked_by: auth.userId })
      .eq("church_id", auth.churchId).eq("service_date", serviceDate)
      .is("app_checked_at", null).lte("created_at", through);
    if (error) throw error;
    revalidatePath(`/dashboard/attendance/follow-up/${serviceDate}`);
    revalidatePath("/dashboard/attendance/follow-up/log");
    revalidatePath("/dashboard");
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "We couldn't save your app check. Try again shortly." };
  }
}
