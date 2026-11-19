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

/** Quo's public API: https://www.quo.com/docs (formerly OpenPhone). */
const QUO_MESSAGES_URL = "https://api.quo.com/v1/messages";

/**
 * Sends through Quo. The key goes in `Authorization` as-is (no "Bearer").
 * Quo answers 202 with `{ data: { id, status } }` once the text is queued.
 * Its error bodies are logged by code only and never shown to churches.
 */
export async function sendViaQuo(
  sender: Extract<ChurchSmsSender, { gateway: "quo" }>,
  to: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendSmsResult> {
  const from = sender.fromNumber ?? sender.from;
  let response: Response;
  try {
    response = await fetchImpl(QUO_MESSAGES_URL, {
      method: "POST",
      headers: { Authorization: sender.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from: sender.from, to: [to], content: message.slice(0, 1600) }),
    });
  } catch {
    return { ok: false, error: "SMS delivery failed", from };
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: { id?: unknown }; code?: unknown; title?: unknown }
    | null;

  if (!response.ok) {
    const code = typeof payload?.code === "string" ? payload.code : String(response.status);
    const title = typeof payload?.title === "string" ? payload.title : "SMS delivery failed";
    console.error("[sms] Quo refused the message", { status: response.status, code });
    return { ok: false, error: `${title} (${code})`, from };
  }

  const id = typeof payload?.data?.id === "string" ? payload.data.id : null;
  return { ok: true, messageId: id, from };
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

  if (sender.gateway === "quo") {
    return sendViaQuo(sender, to, message);
  }

  const result = await sendSmsMobileApi({
    apiKey: sender.apiKey,
    recipients: to,
    message,
    deviceSid: sender.deviceSid,
  });
  return { ...result, from: sender.fromNumber };
}
