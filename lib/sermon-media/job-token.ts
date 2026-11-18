import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The capability a worker holds for one job attempt.
 *
 *     FFJ1.<base64url {v, j, l, e}>.<HMAC-SHA256>
 *
 * Bound to the job id and its current lease token: once the dispatcher
 * reclaims a lease, every token issued for the old lease stops working, because
 * each callback re-checks the lease in the database. Expiry is a backstop.
 * Never log it.
 */
type Payload = { v: 1; j: string; l: string; e: number };

const DOMAIN = "faithform.sermon-media.job.v1";
const PREFIX = "FFJ1";
export const JOB_TOKEN_TTL_SECONDS = 6 * 60 * 60;

function secret(): string | null {
  const value = process.env.SERMON_MEDIA_WORKER_SECRET?.trim();
  if (!value || value.length < 32 || value.startsWith("replace-me")) return null;
  return value;
}

function sign(material: string, body: string): string {
  const key = createHmac("sha256", material).update(DOMAIN).digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function jobTokensConfigured(): boolean {
  return secret() !== null;
}

export function signJobToken(input: { jobId: string; leaseToken: string; nowSeconds?: number }): string {
  const material = secret();
  if (!material) throw new Error("SERMON_MEDIA_WORKER_SECRET is not configured.");
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: Payload = { v: 1, j: input.jobId, l: input.leaseToken, e: now + JOB_TOKEN_TTL_SECONDS };
  const body = `${PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign(material, body)}`;
}

export function verifyJobToken(
  token: string | null | undefined,
  jobId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { leaseToken: string } | null {
  const material = secret();
  if (!material || !token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(material, body));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.j !== jobId || typeof payload.l !== "string" || payload.e < nowSeconds) return null;
  return { leaseToken: payload.l };
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}
