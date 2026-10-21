const SMS_MOBILE_API_URL = "https://api.smsmobileapi.com/sendsms/";
const SMS_MOBILE_LIST_URL = "https://api.smsmobileapi.com/gateway/mobile/list/";

export type SmsDeliveryStatus = "queued" | "sent" | "failed";

/** Only handset confirmation counts as sent; HTTP/API acceptance is queued. */
export function parseSmsMobileDelivery(row: Record<string, unknown>): SmsDeliveryStatus {
  if (String(row.send_from_mobile) === "1") return "sent";
  if ([row.error_api, row.send_from_mobile_erreur].some((value) =>
    value != null && !["", "0", "false"].includes(String(value).trim().toLowerCase()),
  )) return "failed";
  return "queued";
}

export async function getSmsMobileDelivery(input: {
  apiKey: string;
  messageId: string;
  deviceSid?: string | null;
}): Promise<SmsDeliveryStatus | null> {
  const url = new URL("https://api.smsmobileapi.com/log/sent/sms/");
  url.searchParams.set("apikey", input.apiKey);
  url.searchParams.set("guid_message", input.messageId);
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Text delivery status is unavailable.");
  const payload = await response.json() as {
    result?: { error?: unknown; sms?: Record<string, unknown>[] };
  };
  if (!["", "0"].includes(String(payload.result?.error ?? ""))) {
    throw new Error("Text delivery status is unavailable.");
  }
  const row = payload.result?.sms?.find((item) => String(item.guid_message) === input.messageId);
  if (!row) return null;
  // A connected account can contain multiple handsets. Match the one used.
  if (input.deviceSid && String(row.sIdentifiantPhone) !== input.deviceSid) return null;
  return parseSmsMobileDelivery(row);
}

type SmsMobileApiResponse = {
  result?: {
    error?: number | string;
    sent?: string;
    id?: string;
    note?: string;
  };
};

export type SmsMobileApiResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

export type SmsMobileDevice = {
  sid: string;
  label: string | null;
  online: boolean | null;
  raw: Record<string, unknown>;
};

type SmsMobileDeviceResponse = {
  success?: boolean | number | string;
  items?: Array<Record<string, unknown>>;
  result?: {
    error?: number | string;
    mobiles?: Array<Record<string, unknown>>;
    mobile?: Array<Record<string, unknown>>;
  };
};

function parseApiError(result: SmsMobileApiResponse["result"]): string {
  const code = result?.error;
  if (code === undefined || code === null) {
    return result?.note ?? "SMS delivery failed";
  }

  if (String(code) === "subscription_expire") {
    return "SMSMobileAPI subscription expired — renew in the SMSMobileAPI app";
  }

  const numericCode = Number(code);
  if (!Number.isNaN(numericCode)) {
    if (numericCode === 0) {
      if (String(result?.sent ?? "").toLowerCase() === "no") {
        return result?.note ?? "SMS was not sent by the gateway";
      }
      return result?.note ?? "SMS delivery failed";
    }
    if (numericCode === 1) {
      return "SMS gateway unauthorized — check your API key";
    }
    if (numericCode === 2) {
      return "SMS gateway phone is offline — open the SMSMobileAPI app";
    }
  }

  return result?.note ?? `SMS delivery failed (${String(code)})`;
}

/**
 * Sends through SMSMobileAPI, which texts from the handset its app runs on.
 * The key decides whose phone that is, so it is always the church's own key
 * (see `getChurchSmsSender`), never a server-wide default.
 */
export async function sendSmsMobileApi(input: {
  apiKey: string;
  recipients: string;
  message: string;
  deviceSid?: string | null;
}): Promise<SmsMobileApiResult> {
  const apikey = input.apiKey.trim();
  if (!apikey) {
    return { ok: false, error: "SMS is not configured" };
  }

  const body = new URLSearchParams({
    apikey,
    recipients: input.recipients,
    message: input.message,
    sendsms: "1",
    sendwa: "0",
  });
  if (input.deviceSid?.trim()) body.set("sIdentifiant", input.deviceSid.trim());

  let response: Response;
  try {
    response = await fetch(SMS_MOBILE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    return { ok: false, error: message };
  }

  let payload: SmsMobileApiResponse;
  try {
    payload = (await response.json()) as SmsMobileApiResponse;
  } catch {
    const detail = await response.text();
    return {
      ok: false,
      error: detail.slice(0, 200) || "Invalid SMS API response",
    };
  }

  const result = payload.result;
  const errorRaw = result?.error;
  const errorCode = Number(errorRaw ?? -1);
  const sent = String(result?.sent ?? "").toLowerCase() === "1";
  const explicitFailure =
    errorRaw !== undefined &&
    errorRaw !== null &&
    String(errorRaw) !== "0" &&
    (Number.isNaN(errorCode) || errorCode !== 0);

  if (!response.ok || explicitFailure || !sent) {
    return { ok: false, error: parseApiError(result) };
  }

  return { ok: true, messageId: result?.id ?? null };
}

/** Lists the phones connected to one SMSMobileAPI account. Server-side only. */
export async function listSmsMobileDevices(
  apiKey: string,
): Promise<{ ok: true; devices: SmsMobileDevice[] } | { ok: false; error: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "SMS is not configured" };

  const url = new URL(SMS_MOBILE_LIST_URL);
  url.searchParams.set("apikey", key);
  let response: Response;
  try {
    response = await fetch(url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5_000) });
  } catch {
    return { ok: false, error: "We couldn't reach the texting phone service." };
  }

  let payload: SmsMobileDeviceResponse;
  try {
    payload = (await response.json()) as SmsMobileDeviceResponse;
  } catch {
    return { ok: false, error: "Invalid SMS gateway response" };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid SMS gateway response" };
  }
  const result = payload.result;
  const errorCode = String(result?.error ?? "0");
  const explicitFailure = payload.success !== undefined && ![true, 1, "1", "true"].includes(payload.success);
  if (!response.ok || explicitFailure || (errorCode !== "0" && errorCode !== "")) {
    return { ok: false, error: parseApiError(result) };
  }

  // Current responses use success/items. Keep older result.mobile(s) accounts
  // working, and never describe an unrecognized response as an empty fleet.
  const rows = payload.items ?? result?.mobiles ?? result?.mobile;
  if (!Array.isArray(rows)) return { ok: false, error: "Invalid SMS gateway response" };
  return {
    ok: true,
    devices: rows
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const sid = String(row.sIdentifiant ?? row.sIdentifiantPhone ?? row.sid ?? "").trim();
        if (!sid) return null;
        const onlineValue = row.online ?? row.connected ?? row.status;
        return {
          sid,
          label: String(row.label ?? row.name ?? row.phone_number ?? row.phone ?? "").trim() || null,
          online:
            typeof onlineValue === "boolean"
              ? onlineValue
              : onlineValue == null
                ? null
                : /^(online|connected|active|1|true)$/i.test(String(onlineValue).trim())
                  ? true
                  : /^(offline|disconnected|not connected|inactive|0|false)$/i.test(String(onlineValue).trim())
                    ? false
                    : null,
          raw: row,
        };
      })
      .filter((device): device is SmsMobileDevice => Boolean(device)),
  };
}
