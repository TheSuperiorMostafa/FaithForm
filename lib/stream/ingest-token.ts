import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type IngestCapability = {
  version: 1;
  churchId: string;
  exp: number;
  nonce: string;
};

const DEFAULT_INGEST_TTL_SEC = 5 * 60;
export const MAX_INGEST_TTL_SEC = 4 * 60 * 60;

function getIngestSecret(override?: string): string {
  const secret =
    override?.trim() || process.env.STREAM_INGEST_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32 || secret.startsWith("replace-me")) {
    throw new Error("Browser ingest is unavailable.");
  }
  return secret;
}

export function signIngestToken(
  churchId: string,
  options?: {
    nowSec?: number;
    secret?: string;
    nonce?: string;
    ttlSec?: number;
  },
): string {
  const ttlSec = options?.ttlSec ?? DEFAULT_INGEST_TTL_SEC;
  if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > MAX_INGEST_TTL_SEC) {
    throw new Error("Invalid ingest capability lifetime.");
  }
  const payload: IngestCapability = {
    version: 1,
    churchId,
    exp: (options?.nowSec ?? Math.floor(Date.now() / 1000)) + ttlSec,
    nonce: options?.nonce ?? randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getIngestSecret(options?.secret))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyIngestToken(
  token: string,
  options?: { nowSec?: number; secret?: string },
): IngestCapability | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || token.length > 2048) return null;

  const expected = createHmac("sha256", getIngestSecret(options?.secret))
    .update(body)
    .digest("base64url");
  try {
    const actualBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expected, "base64url");
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Partial<IngestCapability>;
    const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
    if (
      payload.version !== 1 ||
      !payload.churchId ||
      !payload.nonce ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowSec ||
      payload.exp > nowSec + MAX_INGEST_TTL_SEC
    ) {
      return null;
    }
    return payload as IngestCapability;
  } catch {
    return null;
  }
}

export function buildCapabilityStreamName(
  churchId: string,
  token: string,
): string {
  return `${churchId}?token=${encodeURIComponent(token)}`;
}
