/**
 * APNs and FCM adapters.
 *
 * Both classify a provider response into one of four outcomes the outbox
 * understands. That classification is the important part: it decides whether a
 * job retries, gives up, or invalidates a token, and getting it wrong either
 * loses notifications or hammers a provider that already said no.
 *
 * Credentials are read from the environment and never leave the server. When
 * they are absent the adapter reports `not_configured` and the worker records
 * a skipped attempt — it does not fall back to a weaker configuration to make
 * local development easier.
 */

export type DeliveryOutcome = "sent" | "retryable" | "permanent" | "skipped";

export type DeliveryResult = {
  outcome: DeliveryOutcome;
  /** A category, never the provider's raw body: that can echo a token. */
  errorCategory?: string;
  providerStatus?: number;
  /** True when the token is dead and the installation must be invalidated. */
  invalidToken?: boolean;
};

export type PushMessage = {
  title: string;
  body: string | null;
  deepLink: string;
  collapseKey: string;
  correlationId: string;
};

export interface PushAdapter {
  readonly provider: "apns" | "fcm";
  isConfigured(): boolean;
  send(token: string, message: PushMessage): Promise<DeliveryResult>;
}

/**
 * APNs status classification, per Apple's documented reason codes.
 *
 * 410 and `BadDeviceToken` are the two that mean "stop sending here" — anything
 * else that fails is either our fault (permanent) or theirs (retryable).
 */
export function classifyApnsResponse(
  status: number,
  reason?: string,
): DeliveryResult {
  if (status >= 200 && status < 300) return { outcome: "sent", providerStatus: status };

  // The token is no longer valid for this topic.
  if (status === 410 || reason === "BadDeviceToken" || reason === "Unregistered") {
    return {
      outcome: "permanent",
      errorCategory: "invalid_token",
      providerStatus: status,
      invalidToken: true,
    };
  }

  // Too many requests for this device, or APNs is unavailable.
  if (status === 429 || status === 500 || status === 503) {
    return { outcome: "retryable", errorCategory: "provider_unavailable", providerStatus: status };
  }

  // Our credential is wrong. Retrying will not fix it, and hammering makes it
  // worse, so this is terminal for the job.
  if (status === 403) {
    return { outcome: "permanent", errorCategory: "auth_rejected", providerStatus: status };
  }

  if (status === 413) {
    return { outcome: "permanent", errorCategory: "payload_too_large", providerStatus: status };
  }

  if (status === 400) {
    return { outcome: "permanent", errorCategory: "malformed_request", providerStatus: status };
  }

  return { outcome: "retryable", errorCategory: "unclassified", providerStatus: status };
}

/**
 * FCM v1 error classification, per Google's documented error codes.
 */
export function classifyFcmResponse(
  status: number,
  errorCode?: string,
): DeliveryResult {
  if (status >= 200 && status < 300) return { outcome: "sent", providerStatus: status };

  if (
    status === 404 ||
    errorCode === "UNREGISTERED" ||
    errorCode === "INVALID_ARGUMENT" && status === 400
  ) {
    // UNREGISTERED is unambiguous. A 404 on the send endpoint means the token
    // is gone rather than the endpoint being wrong.
    const invalid = status === 404 || errorCode === "UNREGISTERED";
    return {
      outcome: "permanent",
      errorCategory: invalid ? "invalid_token" : "malformed_request",
      providerStatus: status,
      invalidToken: invalid,
    };
  }

  if (status === 429 || errorCode === "QUOTA_EXCEEDED") {
    return { outcome: "retryable", errorCategory: "quota_exceeded", providerStatus: status };
  }

  if (status === 503 || status >= 500 || errorCode === "UNAVAILABLE") {
    return { outcome: "retryable", errorCategory: "provider_unavailable", providerStatus: status };
  }

  if (status === 401 || status === 403 || errorCode === "SENDER_ID_MISMATCH") {
    return { outcome: "permanent", errorCategory: "auth_rejected", providerStatus: status };
  }

  return { outcome: "retryable", errorCategory: "unclassified", providerStatus: status };
}

/**
 * The payload is a hint, not the content.
 *
 * It carries a title, a short body, and a deep link — never the announcement
 * itself. The app fetches the current authorized version when opened, so a
 * notification delivered after an edit or a withdrawal cannot show stale or
 * unauthorized text.
 */
export function buildApnsPayload(message: PushMessage): Record<string, unknown> {
  return {
    aps: {
      alert: { title: message.title, body: message.body ?? "" },
      sound: "default",
      "thread-id": message.collapseKey,
      "mutable-content": 1,
    },
    faithful: { deepLink: message.deepLink, correlationId: message.correlationId },
  };
}

export function buildFcmPayload(
  token: string,
  message: PushMessage,
): Record<string, unknown> {
  return {
    message: {
      token,
      notification: { title: message.title, body: message.body ?? "" },
      data: { deepLink: message.deepLink, correlationId: message.correlationId },
      android: {
        collapse_key: message.collapseKey,
        priority: "HIGH",
        notification: { channel_id: "faithful_announcements" },
      },
    },
  };
}

import {
  ApnsTokenProvider,
  FcmTokenProvider,
  readApnsConfig,
  readFcmConfig,
} from "@/lib/faithful/push/provider-auth";

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export class ApnsAdapter implements PushAdapter {
  readonly provider = "apns" as const;
  private readonly tokens: ApnsTokenProvider;

  constructor(tokens: ApnsTokenProvider = new ApnsTokenProvider()) {
    this.tokens = tokens;
  }

  isConfigured(): boolean {
    return readApnsConfig() !== null && Boolean(envValue("APNS_TOPIC"));
  }

  async send(token: string, message: PushMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      // Fails closed. No fallback, no relaxed configuration.
      return { outcome: "skipped", errorCategory: "not_configured" };
    }

    // The provider token is signed here, from server-only configuration.
    const authorization = this.tokens.authorization();
    if (!authorization.ok) {
      return {
        outcome: authorization.reason === "not_configured" ? "skipped" : "permanent",
        errorCategory: authorization.reason,
      };
    }

    const host = envValue("APNS_HOST") ?? "https://api.push.apple.com";
    try {
      const response = await fetch(`${host}/3/device/${token}`, {
        method: "POST",
        headers: {
          "apns-topic": envValue("APNS_TOPIC")!,
          "apns-push-type": "alert",
          "apns-collapse-id": message.collapseKey.slice(0, 64),
          authorization: `bearer ${authorization.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(buildApnsPayload(message)),
      });

      let reason: string | undefined;
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        reason = safeReason(text);
      }

      const result = classifyApnsResponse(response.status, reason);
      // A rejected credential means our signed token is wrong or stale; drop it
      // so the next attempt signs a fresh one rather than replaying a bad one.
      if (result.errorCategory === "auth_rejected") this.tokens.invalidate();
      return result;
    } catch {
      // The error is not echoed: it can contain the URL, which contains the
      // device token.
      return { outcome: "retryable", errorCategory: "transport" };
    }
  }
}

export class FcmAdapter implements PushAdapter {
  readonly provider = "fcm" as const;
  private readonly tokens: FcmTokenProvider;

  constructor(tokens: FcmTokenProvider = new FcmTokenProvider()) {
    this.tokens = tokens;
  }

  isConfigured(): boolean {
    return readFcmConfig() !== null;
  }

  async send(token: string, message: PushMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return { outcome: "skipped", errorCategory: "not_configured" };
    }

    // Exchanged here, from the configured service account.
    const authorization = await this.tokens.authorization();
    if (!authorization.ok) {
      return {
        outcome:
          authorization.reason === "not_configured"
            ? "skipped"
            : authorization.reason === "exchange_failed"
              ? "retryable"
              : "permanent",
        errorCategory: authorization.reason,
      };
    }

    const projectId = this.tokens.projectId();
    if (!projectId) {
      return { outcome: "skipped", errorCategory: "not_configured" };
    }

    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${authorization.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(buildFcmPayload(token, message)),
        },
      );

      let errorCode: string | undefined;
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        errorCode = safeErrorCode(text);
      }

      const result = classifyFcmResponse(response.status, errorCode);
      if (result.errorCategory === "auth_rejected") this.tokens.invalidate();
      return result;
    } catch {
      return { outcome: "retryable", errorCategory: "transport" };
    }
  }
}

/**
 * Extracts only the documented reason/code keyword from a provider body.
 * Nothing else from that body is retained, because it may echo the token or
 * the payload back at us.
 */
export function safeReason(body: string): string | undefined {
  const match = /"reason"\s*:\s*"([A-Za-z]+)"/.exec(body);
  return match?.[1];
}

export function safeErrorCode(body: string): string | undefined {
  const match = /"status"\s*:\s*"([A-Z_]+)"/.exec(body);
  return match?.[1];
}

/** Deterministic adapter for tests and for local development without credentials. */
export class FakePushAdapter implements PushAdapter {
  readonly provider: "apns" | "fcm";
  private readonly script: DeliveryResult[];
  public sent: { token: string; message: PushMessage }[] = [];

  constructor(provider: "apns" | "fcm", script: DeliveryResult[] = []) {
    this.provider = provider;
    this.script = [...script];
  }

  isConfigured(): boolean { return true; }

  async send(token: string, message: PushMessage): Promise<DeliveryResult> {
    this.sent.push({ token, message });
    return this.script.shift() ?? { outcome: "sent", providerStatus: 200 };
  }
}
