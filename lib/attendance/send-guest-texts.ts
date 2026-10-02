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
}): Promise<GuestTextSendSummary> {
  const summary: GuestTextSendSummary = {
    sent: 0,
    failed: 0,
    skipped: 0,
    notConnected: false,
  };
  if (input.guests.length === 0) return summary;

  const admin = createAdminClient();
  const smsSender = await getChurchSmsSender(input.churchId, admin);
  if (!smsSender) {
    summary.notConnected = true;
    summary.skipped = input.guests.length;
    return summary;
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
    if (result.ok) summary.sent += 1;
    else summary.failed += 1;
  }

  return summary;
}
