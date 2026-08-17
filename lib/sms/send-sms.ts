import { toE164 } from "@/lib/sms/phone";
import {
  isSmsMobileApiConfigured,
  sendSmsMobileApi,
} from "@/lib/sms/sms-mobile-api";

export type SendSmsResult =
  | { ok: true; messageId: string | null; from: string | null }
  | { ok: false; error: string; from: string | null };

/**
 * The line texts leave on, for the follow-up log. Twilio has an explicit from
 * number; SMS Mobile API sends from the church's own linked handset, which the
 * API never reports back, so it is configured here when known.
 */
export function smsSenderNumber(): string | null {
  if (isSmsMobileApiConfigured()) {
    return process.env.SMS_MOBILE_API_NUMBER?.trim() || null;
  }
  return process.env.TWILIO_FROM_NUMBER?.trim() || null;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER,
  );
}

export function isSmsConfigured(): boolean {
  return isSmsMobileApiConfigured() || twilioConfigured();
}

async function sendViaTwilio(to: string, message: string): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;

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

export async function sendSms(
  phone: string,
  message: string,
): Promise<SendSmsResult> {
  const to = toE164(phone);
  if (!to) {
    return { ok: false, error: "Invalid phone number on file", from: null };
  }

  if (isSmsMobileApiConfigured()) {
    const result = await sendSmsMobileApi({ recipients: to, message });
    return { ...result, from: smsSenderNumber() };
  }

  if (twilioConfigured()) {
    return sendViaTwilio(to, message);
  }

  return { ok: false, error: "SMS is not configured", from: null };
}
