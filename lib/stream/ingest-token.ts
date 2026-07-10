import { createHmac, timingSafeEqual } from "crypto";

const INGEST_TTL_SEC = 3600;

function getIngestSecret(): string {
  const secret =
    process.env.STREAM_PLAYBACK_SECRET?.trim() ??
    process.env.STREAM_RELAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing ingest signing secret");
  }
  return secret;
}

export function signIngestToken(churchId: string, publishKey: string): string {
  const exp = Math.floor(Date.now() / 1000) + INGEST_TTL_SEC;
  const body = `${churchId}:${publishKey}:${exp}`;
  const sig = createHmac("sha256", getIngestSecret())
    .update(body)
    .digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}

export function verifyIngestToken(token: string): {
  churchId: string;
  publishKey: string;
} | null {
  const [bodyB64, sig] = token.split(".");
  if (!bodyB64 || !sig) return null;

  const body = Buffer.from(bodyB64, "base64url").toString("utf8");
  const expected = createHmac("sha256", getIngestSecret())
    .update(body)
    .digest("base64url");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const [churchId, publishKey, expStr] = body.split(":");
  const exp = Number(expStr);
  if (!churchId || !publishKey || !exp || exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return { churchId, publishKey };
}
