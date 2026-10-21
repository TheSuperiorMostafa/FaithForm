import {
  personalizeWelcomeMessage,
  type FirstTimeGuest,
} from "@/lib/attendance/first-time-guests";
import { getChurchSmsSender } from "@/lib/sms/church-sender";
import { sendSms } from "@/lib/sms/send-sms";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TEXTING_NOT_CONNECTED =
  "No texting phone is connected for this church yet";

export type GuestTextSendSummary = {
  sent: number;
  failed: number;
  skipped: number;
  notConnected: boolean;
  requiresAppCheck: boolean;
};

/**
 * Where "Tell pastor" texts go: the church phone in Settings, or — if that is
 * blank — the number on the church's own texting phone. Never invents a
 * destination.
 */
export async function resolvePastorNotifyPhone(
  churchId: string,
  admin?: SupabaseClient,
): Promise<{ phone: string; source: "church_phone" | "texting_phone" } | null> {
  const client = admin ?? createAdminClient();
  const { data: church } = await client
    .from("churches")
    .select("phone")
    .eq("id", churchId)
    .maybeSingle();

  const churchPhone = (church?.phone as string | null | undefined)?.trim();
  if (churchPhone) {
    return { phone: churchPhone, source: "church_phone" };
  }

  const smsSender = await getChurchSmsSender(churchId, client);
  const fromNumber = smsSender?.fromNumber?.trim();
  if (fromNumber) {
    return { phone: fromNumber, source: "texting_phone" };
  }

  return null;
}

/** One SMS to the pastor/church phone listing first-time guests. */
export async function sendPastorGuestNotice(input: {
  churchId: string;
  phone: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string; notConnected?: boolean }> {
  const admin = createAdminClient();
  const smsSender = await getChurchSmsSender(input.churchId, admin);
  if (!smsSender) {
    return { ok: false, error: TEXTING_NOT_CONNECTED, notConnected: true };
  }

  const result = await sendSms(smsSender, input.phone, input.message);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

/** Welcome texts to first-time guests who left a phone number. */
export async function sendWelcomeGuestTexts(input: {
  churchId: string;
  churchName: string;
  guests: FirstTimeGuest[];
  messageTemplate: string;
  serviceDate: string;
  senderUserId: string;
}): Promise<GuestTextSendSummary> {
  const summary: GuestTextSendSummary = {
    sent: 0,
    failed: 0,
    skipped: 0,
    notConnected: false,
    requiresAppCheck: false,
  };
  if (input.guests.length === 0) return summary;

  const admin = createAdminClient();
  const smsSender = await getChurchSmsSender(input.churchId, admin);
  if (!smsSender) {
    summary.notConnected = true;
    summary.skipped = input.guests.length;
    return summary;
  }

  if (smsSender.gateway === "smsmobileapi") {
    const { error } = await admin.from("attendance_follow_up_log").select("delivery_confirmed_at").limit(0);
    if (error) throw new Error("Text delivery tracking needs a database update before sending.");
  }

  for (const guest of input.guests) {
    if (!guest.phone?.trim()) {
      summary.skipped += 1;
      continue;
    }
    const message = personalizeWelcomeMessage(
      input.messageTemplate,
      guest.firstName,
      input.churchName,
    );
    const result = await sendSms(smsSender, guest.phone, message);
    const { error: logError } = await admin.from("attendance_follow_up_log").insert({
      church_id: input.churchId,
      service_date: input.serviceDate,
      member_id: guest.memberId,
      recipient_name: `${guest.firstName} ${guest.lastName ?? ""}`.trim(),
      recipient_phone: guest.phone,
      message,
      status: result.ok ? (smsSender.gateway === "smsmobileapi" ? "queued" : "sent") : "failed",
      sms_id: result.ok ? result.messageId : null,
      error: result.ok ? null : result.error,
      sender_phone: result.from,
      sender_user_id: input.senderUserId,
    });
    if (logError) console.error("[attendance-welcome] could not record text request");
    if (result.ok) {
      summary.sent += 1;
      summary.requiresAppCheck ||= smsSender.gateway === "smsmobileapi";
    } else summary.failed += 1;
  }

  return summary;
}
