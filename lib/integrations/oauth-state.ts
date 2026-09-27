import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

const SEP = ".";
const ENCRYPTED_VERSION = "v2";
const MAX_STATE_LENGTH = 8192;

function stateEncryptionKey(): Buffer {
  return createHash("sha256")
    .update("faithform-oauth-state-v2\0")
    .update(getSecret())
    .digest();
}

function getSecret() {
  const oauthSecret = process.env.INTEGRATION_OAUTH_STATE_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!oauthSecret || oauthSecret === "replace-me-long-random-string") {
      throw new Error("Missing INTEGRATION_OAUTH_STATE_SECRET in production");
    }
    return oauthSecret;
  }

  const secret = oauthSecret ?? process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing INTEGRATION_OAUTH_STATE_SECRET or N8N_WEBHOOK_SECRET");
  }
  return secret;
}

/** Long enough to find a password at Google or Facebook, short enough not to be kept. */
export const OAUTH_STATE_TTL_SECONDS = 30 * 60;

/**
 * A same-site path, or nothing. `//evil.example` and `/\evil.example` are
 * paths to a URL parser and hosts to a browser, and the callback redirects to
 * this value before it knows who is asking.
 */
export function safeReturnTo(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\/(?![/\\])/.test(trimmed) || /[\\\u0000-\u001f]/.test(trimmed)) return undefined;
  return trimmed;
}

export type OAuthStatePayload = {
  churchId: string;
  userId: string;
  provider: "google" | "facebook" | "youtube";
  returnTo?: string;
  /** Which way in was checked when the state was made; the callback checks it again. */
  via: "admin" | "invite";
  /** Unix seconds. */
  exp: number;
};

export function signOAuthState(input: {
  churchId: string;
  userId: string;
  provider: "google" | "facebook" | "youtube";
  returnTo?: string;
  via: "admin" | "invite";
}): string {
  const payload: OAuthStatePayload = {
    ...input,
    returnTo: safeReturnTo(input.returnTo),
    exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS,
  };
  // OAuth providers receive state in the authorization URL. An onboarding
  // return path can contain an invite token, so it must be opaque to them.
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    ENCRYPTED_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(SEP);
}

function decodeEncryptedState(state: string): string | null {
  const [version, ivText, encryptedText, tagText, extra] = state.split(SEP);
  if (version !== ENCRYPTED_VERSION || !ivText || !encryptedText || !tagText || extra) return null;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", stateEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function decodeLegacyState(state: string): string | null {
  const [body, sig, extra] = state.split(SEP);
  if (!body || !sig || extra) return null;
  const expected = createHmac("sha256", getSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(body, "base64url").toString("utf8");
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  if (!state || state.length > MAX_STATE_LENGTH) return null;
  try {
    // Existing signed states can finish during a rolling deployment; they
    // expire after 30 minutes. Every newly issued state uses encryption.
    const decoded = state.startsWith(`${ENCRYPTED_VERSION}${SEP}`)
      ? decodeEncryptedState(state)
      : decodeLegacyState(state);
    if (!decoded) return null;
    const parsed = JSON.parse(decoded) as Partial<OAuthStatePayload>;
    if (!parsed.churchId || !parsed.userId || !parsed.provider) return null;
    // A state without an expiry was made before states expired; one copied
    // out of an old redirect must not bind a church's account years later.
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 <= Date.now()) return null;
    if (parsed.via !== "admin" && parsed.via !== "invite") return null;
    return { ...parsed, returnTo: safeReturnTo(parsed.returnTo) } as OAuthStatePayload;
  } catch {
    return null;
  }
}
