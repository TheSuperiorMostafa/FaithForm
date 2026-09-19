import type { ChurchSmsSender } from "@/lib/sms/church-sender";
import { toE164 } from "@/lib/sms/phone";
import { sendSmsMobileApi } from "@/lib/sms/sms-mobile-api";

export type SendSmsResult =
  | { ok: true; messageId: string | null; from: string | null }
  | { ok: false; error: string; from: string | null };

async function sendViaTwilio(
  sender: Extract<ChurchSmsSender, { gateway: "twilio" }>,
  to: string,
  message: string,
): Promise<SendSmsResult> {
  const { accountSid, authToken, fromNumber: from } = sender;
  const body = new URLSearchParams({ To: to, From: from, Body: message });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    return {
      ok: false,
      error: detail.slice(0, 200) || "SMS delivery failed",
      from,
    };
  }

  return { ok: true, messageId: null, from };
}

/**
 * Texts one person from one church's phone.
 *
 * The sender is always passed in — resolved per church by
 * `getChurchSmsSender` — so there is no path that texts a church's members
 * from a phone that isn't theirs.
 */
export async function sendSms(
  sender: ChurchSmsSender,
  phone: string,
  message: string,
): Promise<SendSmsResult> {
  const to = toE164(phone);
  if (!to) {
    return { ok: false, error: "Invalid phone number on file", from: sender.fromNumber };
  }

  if (sender.gateway === "twilio") {
    return sendViaTwilio(sender, to, message);
  }

  const result = await sendSmsMobileApi({
    apiKey: sender.apiKey,
    recipients: to,
    message,
  });
  return { ...result, from: sender.fromNumber };
}
