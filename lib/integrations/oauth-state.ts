import { createHmac, timingSafeEqual } from "crypto";

const SEP = ".";

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
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}${SEP}${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload | null {
  const [body, sig] = state.split(SEP);
  if (!body || !sig) return null;

  const expected = createHmac("sha256", getSecret()).update(body).digest("base64url");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<OAuthStatePayload>;
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
