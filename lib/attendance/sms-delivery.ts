import type { SupabaseClient } from "@supabase/supabase-js";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { getSmsMobileDelivery } from "@/lib/sms/sms-mobile-api";

/** Reconcile only this church's references using this church's credentials. */
export async function reconcileAttendanceTexts(admin: SupabaseClient, churchId: string, serviceDate?: string) {
  const sender = await getChurchSmsSender(churchId, admin);
  if (sender?.gateway !== "smsmobileapi") {
    await admin.from("attendance_follow_up_log").update({ delivery_checked_at: new Date().toISOString() })
      .eq("church_id", churchId).eq("status", "queued");
    return { checked: 0, confirmed: 0 };
  }
  let query = admin.from("attendance_follow_up_log")
    .select("id, sms_id, entry_id")
    .eq("church_id", churchId).eq("status", "queued")
    .not("sms_id", "is", null)
    .order("delivery_checked_at", { ascending: true, nullsFirst: true }).limit(10);
  if (serviceDate) query = query.eq("service_date", serviceDate);
  const { data, error } = await query;
  if (error) throw new Error("Text delivery tracking needs a database update.");
  let confirmed = 0;
  // Bounded concurrency keeps the app check within its request budget.
  await Promise.all((data ?? []).map(async (row) => {
    const now = new Date().toISOString();
    let status: Awaited<ReturnType<typeof getSmsMobileDelivery>> = null;
    try {
      status = await getSmsMobileDelivery({ apiKey: sender.apiKey, messageId: row.sms_id, deviceSid: sender.deviceSid });
    } catch {
      // A provider outage leaves the request queued for the next check.
    }
    const patch = {
      delivery_checked_at: now,
      ...(status === "sent" ? { status, delivery_confirmed_at: now, error: null } : {}),
      ...(status === "failed" ? { status, error: "The texting phone reported a sending error" } : {}),
    };
    const { data: updated, error: updateError } = await admin.from("attendance_follow_up_log")
      .update(patch).eq("id", row.id).eq("church_id", churchId).eq("status", "queued").select("id").maybeSingle();
    if (updateError) throw new Error("We couldn't save the text delivery status.");
    if (status === "sent" && updated) confirmed += 1;
    if (status === "failed" && row.entry_id) {
      await admin.from("attendance_entries").update({ follow_up_error: patch.error, follow_up_sent_at: null })
        .eq("id", row.entry_id).eq("church_id", churchId).eq("follow_up_sms_id", row.sms_id);
    }
  }));
  return { checked: data?.length ?? 0, confirmed };
}

export async function hasUncheckedAttendanceTexts(admin: SupabaseClient, churchId: string, serviceDate: string) {
  const { data, error } = await admin.from("attendance_follow_up_log").select("id")
    .eq("church_id", churchId).eq("service_date", serviceDate)
    .is("app_checked_at", null).in("status", ["queued", "sent"]).limit(1);
  if (error) return false; // Old deployments can still display their existing history.
  return Boolean(data?.length);
}
