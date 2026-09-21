const SMS_MOBILE_API_URL = "https://api.smsmobileapi.com/sendsms/";
const SMS_MOBILE_LIST_URL = "https://api.smsmobileapi.com/gateway/mobile/list/";

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
    response = await fetch(url, { method: "GET" });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Network error" };
  }

  let payload: SmsMobileDeviceResponse;
  try {
    payload = (await response.json()) as SmsMobileDeviceResponse;
  } catch {
    return { ok: false, error: "Invalid SMS gateway response" };
  }

  const result = payload.result;
  const errorCode = String(result?.error ?? "0");
  if (!response.ok || (errorCode !== "0" && errorCode !== "")) {
    return { ok: false, error: parseApiError(result) };
  }

  const rows = result?.mobiles ?? result?.mobile ?? [];
  return {
    ok: true,
    devices: rows
      .map((row) => {
        const sid = String(row.sIdentifiant ?? row.sIdentifiantPhone ?? row.sid ?? "").trim();
        if (!sid) return null;
        const onlineValue = row.online ?? row.connected ?? row.status;
        return {
          sid,
          label: String(row.label ?? row.name ?? row.phone ?? "").trim() || null,
          online:
            typeof onlineValue === "boolean"
              ? onlineValue
              : onlineValue == null
                ? null
                : /online|connected|1|true/i.test(String(onlineValue)),
          raw: row,
        };
      })
      .filter((device): device is SmsMobileDevice => Boolean(device)),
  };
}
