import { createPrivateKey, createSign, type KeyObject } from "node:crypto";

/**
 * Server-side provider authorization for APNs and FCM.
 *
 * Both providers want a short-lived bearer token that this server mints from
 * configuration it alone holds. Prompt 5 originally read a pre-issued token
 * from the environment, which pushed the hard part onto whoever deployed it —
 * this module does the signing properly instead.
 *
 * Three rules govern everything here:
 *
 *  1. **A credential never leaves this module.** No signing key, no signed
 *     token, and no device token is returned to a caller that does not need it,
 *     put in an error message, or logged. `redactForLog` is the only thing that
 *     ever turns one into text.
 *  2. **Fail closed.** Missing or malformed configuration produces a typed
 *     `not_configured` / `invalid_configuration` result, never a fallback to
 *     something weaker.
 *  3. **Refresh before expiry, not after failure.** A token refreshed only when
 *     a request already failed means every rotation costs a dropped
 *     notification.
 */

export type ProviderAuthResult =
  | { ok: true; token: string; expiresAtMs: number }
  | { ok: false; reason: "not_configured" | "invalid_configuration" | "exchange_failed" };

/**
 * Turns anything credential-shaped into something safe to print.
 *
 * Used in the one place a token could plausibly reach a log line, so that
 * "we accidentally logged it" is a bug in one function rather than anywhere.
 */
export function redactForLog(value: string | null | undefined): string {
  if (!value) return "<absent>";
  if (value.length <= 8) return "<redacted>";
  // Enough to correlate two sightings of the same token; far too little to use.
  return `<redacted:${value.length}:${value.slice(0, 4)}…>`;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

/**
 * PEM keys arrive from secret stores with their newlines escaped more often
 * than not. Normalising here means a correctly-pasted key and an
 * escaped-newline key both work, rather than the second failing with an opaque
 * OpenSSL error at send time.
 */
export function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

// ---------------------------------------------------------------------------
// APNs — ES256 provider authentication tokens
// ---------------------------------------------------------------------------

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKeyPem: string;
};

export function readApnsConfig(): ApnsConfig | null {
  const keyId = envValue("APNS_KEY_ID");
  const teamId = envValue("APNS_TEAM_ID");
  const privateKey = envValue("APNS_PRIVATE_KEY");
  if (!keyId || !teamId || !privateKey) return null;
  return { keyId, teamId, privateKeyPem: normalizePem(privateKey) };
}

/**
 * Signs an APNs provider authentication token.
 *
 * ES256 over `header.payload`, per Apple's specification. `ieee-p1363` is the
 * important detail: Node signs ECDSA as DER by default, and APNs rejects that —
 * JOSE wants the raw r‖s pair, which is what this encoding produces.
 *
 * The key object is built from the PEM every call rather than cached, because a
 * cached `KeyObject` is a live credential sitting in module scope for the
 * lifetime of the process.
 */
export function signApnsToken(
  config: ApnsConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: config.keyId, typ: "JWT" }),
  );
  const payload = base64url(
    JSON.stringify({ iss: config.teamId, iat: nowSeconds }),
  );
  const signingInput = `${header}.${payload}`;

  let key: KeyObject;
  try {
    key = createPrivateKey(config.privateKeyPem);
  } catch {
    // The message is deliberately generic: an OpenSSL parse error can echo
    // fragments of the key material back.
    throw new Error("apns_private_key_invalid");
  }

  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key, dsaEncoding: "ieee-p1363" });

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Apple's rules, encoded rather than described: a token is valid for one hour
 * and must not be regenerated more often than once every twenty minutes.
 *
 * Refreshing at 45 minutes sits comfortably inside both — well clear of the
 * 20-minute floor, and with 15 minutes of headroom before expiry so a slow
 * refresh never races a send.
 */
const APNS_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const APNS_REFRESH_AFTER_MS = 45 * 60 * 1000;

type CachedToken = { token: string; issuedAtMs: number; expiresAtMs: number };

/**
 * Caches the signed token and refreshes it on schedule.
 *
 * Deliberately an instance rather than module state so tests can drive the
 * clock, and so two environments in one process cannot share a token.
 */
export class ApnsTokenProvider {
  private cached: CachedToken | null = null;
  private readonly now: () => number;
  private readonly readConfig: () => ApnsConfig | null;

  constructor(options?: { now?: () => number; readConfig?: () => ApnsConfig | null }) {
    this.now = options?.now ?? (() => Date.now());
    this.readConfig = options?.readConfig ?? readApnsConfig;
  }

  isConfigured(): boolean {
    return this.readConfig() !== null;
  }

  authorization(): ProviderAuthResult {
    const config = this.readConfig();
    if (!config) return { ok: false, reason: "not_configured" };

    const nowMs = this.now();

    if (this.cached && nowMs - this.cached.issuedAtMs < APNS_REFRESH_AFTER_MS) {
      return { ok: true, token: this.cached.token, expiresAtMs: this.cached.expiresAtMs };
    }

    try {
      const token = signApnsToken(config, Math.floor(nowMs / 1000));
      this.cached = {
        token,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + APNS_TOKEN_LIFETIME_MS,
      };
      return { ok: true, token, expiresAtMs: this.cached.expiresAtMs };
    } catch {
      // A key that will not parse is a configuration problem, not a transient
      // one — reporting it as retryable would hide it behind a retry loop.
      return { ok: false, reason: "invalid_configuration" };
    }
  }

  /** Forces the next call to re-sign. Used when APNs rejects our credential. */
  invalidate(): void {
    this.cached = null;
  }
}

// ---------------------------------------------------------------------------
// FCM — service-account OAuth 2.0
// ---------------------------------------------------------------------------

export type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKeyPem: string;
  tokenUri: string;
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

/**
 * Reads the service account.
 *
 * Accepts either a whole service-account JSON blob or the three fields
 * separately, because secret stores differ in which they make easy — and a
 * deployment that has to reshape its credential to fit is a deployment that
 * will get it wrong.
 */
export function readFcmConfig(): FcmConfig | null {
  const raw = envValue("FCM_SERVICE_ACCOUNT_JSON");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKeyPem: normalizePem(parsed.private_key),
          tokenUri: parsed.token_uri || DEFAULT_TOKEN_URI,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  const projectId = envValue("FCM_PROJECT_ID");
  const clientEmail = envValue("FCM_CLIENT_EMAIL");
  const privateKey = envValue("FCM_PRIVATE_KEY");
  if (!projectId || !clientEmail || !privateKey) return null;

  return {
    projectId,
    clientEmail,
    privateKeyPem: normalizePem(privateKey),
    tokenUri: envValue("FCM_TOKEN_URI") ?? DEFAULT_TOKEN_URI,
  };
}

/**
 * Builds the RS256 JWT assertion Google exchanges for an access token.
 *
 * Separate from the exchange itself so the signing can be tested without a
 * network, which is the only part of this that can be verified without real
 * provider access.
 */
export function buildFcmAssertion(
  config: FcmConfig,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: config.tokenUri,
      iat: nowSeconds,
      // Google rejects an assertion valid for more than an hour.
      exp: nowSeconds + 3600,
    }),
  );
  const signingInput = `${header}.${payload}`;

  let key: KeyObject;
  try {
    key = createPrivateKey(config.privateKeyPem);
  } catch {
    throw new Error("fcm_private_key_invalid");
  }

  const signature = createSign("RSA-SHA256").update(signingInput).sign(key);
  return `${signingInput}.${base64url(signature)}`;
}

/** Refresh a minute early so a slow exchange never races a send. */
const FCM_EXPIRY_SKEW_MS = 60 * 1000;

export class FcmTokenProvider {
  private cached: CachedToken | null = null;
  private inFlight: Promise<ProviderAuthResult> | null = null;

  private readonly now: () => number;
  private readonly readConfig: () => FcmConfig | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: {
    now?: () => number;
    readConfig?: () => FcmConfig | null;
    fetchImpl?: typeof fetch;
  }) {
    this.now = options?.now ?? (() => Date.now());
    this.readConfig = options?.readConfig ?? readFcmConfig;
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return this.readConfig() !== null;
  }

  projectId(): string | null {
    return this.readConfig()?.projectId ?? null;
  }

  /**
   * Single-flight, for the same reason session refresh is on the clients: a
   * batch of notifications starting at once must not each exchange their own
   * assertion and burn quota against Google.
   */
  async authorization(): Promise<ProviderAuthResult> {
    const config = this.readConfig();
    if (!config) return { ok: false, reason: "not_configured" };

    const nowMs = this.now();
    if (this.cached && this.cached.expiresAtMs - FCM_EXPIRY_SKEW_MS > nowMs) {
      return { ok: true, token: this.cached.token, expiresAtMs: this.cached.expiresAtMs };
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.exchange(config, nowMs).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async exchange(config: FcmConfig, nowMs: number): Promise<ProviderAuthResult> {
    let assertion: string;
    try {
      assertion = buildFcmAssertion(config, Math.floor(nowMs / 1000));
    } catch {
      return { ok: false, reason: "invalid_configuration" };
    }

    try {
      const response = await this.fetchImpl(config.tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      });

      if (!response.ok) {
        // The body is not read: an OAuth error response echoes the assertion,
        // which contains the signature.
        return { ok: false, reason: "exchange_failed" };
      }

      const parsed = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!parsed.access_token) return { ok: false, reason: "exchange_failed" };

      const lifetimeMs = (parsed.expires_in ?? 3600) * 1000;
      this.cached = {
        token: parsed.access_token,
        issuedAtMs: nowMs,
        expiresAtMs: nowMs + lifetimeMs,
      };

      return { ok: true, token: parsed.access_token, expiresAtMs: this.cached.expiresAtMs };
    } catch {
      return { ok: false, reason: "exchange_failed" };
    }
  }

  invalidate(): void {
    this.cached = null;
  }
}
