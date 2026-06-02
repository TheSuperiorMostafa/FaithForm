import { createHmac, timingSafeEqual } from "crypto";

const SEP = ".";

function getSecret() {
  const secret =
    process.env.INTEGRATION_OAUTH_STATE_SECRET ??
    process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing INTEGRATION_OAUTH_STATE_SECRET or N8N_WEBHOOK_SECRET");
  }
  return secret;
}

export function signOAuthState(payload: {
  churchId: string;
  userId: string;
  provider: "google" | "facebook";
  returnTo?: string;
}): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(body).digest("base64url");
  return `${body}${SEP}${sig}`;
}

export function verifyOAuthState(state: string): {
  churchId: string;
  userId: string;
  provider: "google" | "facebook";
  returnTo?: string;
} | null {
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
    ) as {
      churchId: string;
      userId: string;
      provider: "google" | "facebook";
    };
    if (!parsed.churchId || !parsed.userId || !parsed.provider) return null;
    return parsed;
  } catch {
    return null;
  }
}
