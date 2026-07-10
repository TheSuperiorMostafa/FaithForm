const SMS_MOBILE_API_URL = "https://api.smsmobileapi.com/sendsms/";

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

export function isSmsMobileApiConfigured(): boolean {
  return Boolean(process.env.SMS_MOBILE_API_KEY?.trim());
}

export async function sendSmsMobileApi(input: {
  recipients: string;
  message: string;
}): Promise<SmsMobileApiResult> {
  const apikey = process.env.SMS_MOBILE_API_KEY?.trim();
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
