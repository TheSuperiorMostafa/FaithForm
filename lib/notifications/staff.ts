import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { STAFF_NOTIFICATION_EVENTS, emptyStaffPreferences, staffPreferencesSchema, newlyAvailableAttendancePeriods, type StaffNotificationEvent } from "@/lib/notifications/staff-preferences";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { sendSms } from "@/lib/sms/send-sms";
import { renderEmail } from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";
import { absoluteAppPath } from "@/lib/site-url";
import { parseFeatureKeys } from "@/lib/features/catalog";

type StaffJob = { id: string; church_id: string; user_id: string; event: StaffNotificationEvent; channel: "email" | "phone"; href: string; created_at: string; attempts: number };

/** No names, attendance marks, room names, or pickup codes leave the dashboard. */
export async function queueStaffNotification(input: { churchId: string; event: StaffNotificationEvent; eventKey: string; href: string }, client?: SupabaseClient): Promise<void> {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin.from("staff_notification_preferences").select("user_id, phone, events").eq("church_id", input.churchId);
  if (error) throw new Error("staff_notification_preferences_unavailable");
  const rows = (data ?? []).flatMap(row => {
    const parsed = staffPreferencesSchema.safeParse({ phone: row.phone, events: { ...emptyStaffPreferences().events, ...row.events } });
    if (!parsed.success) return [];
    return (["email", "phone"] as const).filter(channel => parsed.data.events[input.event][channel]).map(channel => ({ church_id: input.churchId, user_id: row.user_id, event: input.event, event_key: input.eventKey, channel, href: input.href }));
  });
  if (!rows.length) return;
  const result = await admin.from("staff_notification_jobs").upsert(rows, { onConflict: "church_id,user_id,event,event_key,channel", ignoreDuplicates: true });
  if (result.error) throw new Error("staff_notification_queue_unavailable");
}

/** Existing saved work must not be reported as failed because a notice failed. */
export async function tryQueueStaffNotification(input: Parameters<typeof queueStaffNotification>[0]): Promise<void> {
  try { await queueStaffNotification(input); } catch { console.error("[staff notifications] Could not queue notification."); }
}

export async function queueAttendanceDocumentNotifications(now = new Date(), client?: SupabaseClient) {
  const admin = client ?? createAdminClient();
  // Only opted-in churches; no historical bulk send when the feature is enabled.
  const { data, error } = await admin.from("staff_notification_preferences").select("church_id, churches(timezone)").or("events->attendance_documents->>email.eq.true,events->attendance_documents->>phone.eq.true");
  if (error) throw new Error("staff_notification_preferences_unavailable");
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (seen.has(row.church_id)) continue;
    seen.add(row.church_id);
    const relation = row.churches as unknown as { timezone: string } | { timezone: string }[] | null;
    const church = Array.isArray(relation) ? relation[0] : relation;
    for (const period of newlyAvailableAttendancePeriods(church?.timezone ?? "America/New_York", now)) {
      await queueStaffNotification({ churchId: row.church_id, event: "attendance_documents", eventKey: period, href: "/dashboard/settings?tab=documents" }, admin);
    }
  }
}

export async function dispatchStaffNotifications(client?: SupabaseClient) {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin.rpc("claim_staff_notification_jobs", { p_limit: 10 });
  if (error) throw new Error("staff_notification_queue_unavailable");
  let sent = 0, failed = 0, skipped = 0;
  for (const job of (data ?? []) as StaffJob[]) {
    let status: "sent" | "failed" | "skipped" | "queued" = "skipped";
    try {
      // Re-check current role, feature grants, preferences and verified email at send time.
      const [membership, preference, state] = await Promise.all([
        admin.from("church_users").select("role, feature_permissions").eq("church_id", job.church_id).eq("user_id", job.user_id).maybeSingle(),
        admin.from("staff_notification_preferences").select("phone, events").eq("church_id", job.church_id).eq("user_id", job.user_id).maybeSingle(),
        admin.from("church_features").select("enabled").eq("church_id", job.church_id).eq("feature_key", STAFF_NOTIFICATION_EVENTS.find(event => event.id === job.event)!.feature).maybeSingle(),
      ]);
      if (membership.error || preference.error || state.error) throw new Error("staff_notification_recipient_unavailable");
      const definition = STAFF_NOTIFICATION_EVENTS.find(event => event.id === job.event)!;
      const current = staffPreferencesSchema.safeParse(preference.data);
      const hasAccess = membership.data && state.data?.enabled !== false && (membership.data.role === "admin" || parseFeatureKeys(membership.data.feature_permissions).includes(definition.feature));
      const fresh = Date.now() - new Date(job.created_at).getTime() < 86_400_000;
      if (hasAccess && fresh && current.success && current.data.events[job.event][job.channel]) {
        const href = absoluteAppPath(job.href);
        const body = job.event === "attendance_completed" ? "Your team saved weekly attendance. Open FaithForm to review it." : job.event === "attendance_documents" ? "An attendance report is ready. Open Documents in FaithForm to download it." : "The Kids desk requested a guardian. Open FaithForm to review the alert.";
        if (job.channel === "email") {
          const user = await admin.auth.admin.getUserById(job.user_id);
          if (user.error) throw new Error("staff_notification_recipient_unavailable");
          if (user.data.user.email && user.data.user.email_confirmed_at) {
            const key = process.env.RESEND_API_KEY;
            if (!key) throw new Error("email_unavailable");
            const content = renderEmail({ title: definition.label, preheader: body, heading: definition.label, blocks: [{ kind: "paragraph", text: body }, { kind: "button", label: "Open FaithForm", url: href }], permissionNote: "You chose this notification in FaithForm Settings. Change your choices in Notifications." });
            const result = await new Resend(key).emails.send({ from: `FaithForm <${resolveFromAddress()}>`, to: user.data.user.email, subject: definition.label, html: content.html, text: content.text }, { idempotencyKey: `staff-notice-${job.id}` });
            if (result.error) throw new Error("email_unavailable");
            status = "sent";
          }
        } else if (current.data.phone) {
          const sender = await getChurchSmsSender(job.church_id, admin);
          if (!sender) throw new Error("sms_unavailable");
          const result = await sendSms(sender, current.data.phone, `${body} ${href}`);
          // Provider acceptance, rather than handset delivery; never credits time saved.
          status = result.ok ? "sent" : "failed";
        }
      }
    } catch {
      // Email retries share Resend's idempotency key. SMS has no equivalent:
      // an uncertain request must not automatically send a second text.
      status = job.channel === "email" && job.attempts < 3 ? "queued" : "failed";
    }
    const saved = await admin.from("staff_notification_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "sending").eq("attempts", job.attempts);
    if (saved.error) throw new Error("staff_notification_result_unavailable");
    if (status === "sent") sent++; else if (status === "skipped") skipped++; else failed++;
  }
  return { sent, failed, skipped };
}
