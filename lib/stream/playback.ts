import { createHmac, timingSafeEqual } from "crypto";
import { absoluteAppPath } from "@/lib/site-url";

export type PlaybackAudience = "public" | "staff";

export type PlaybackCapability = {
  version: 1;
  churchId: string;
  eventId: string;
  audience: PlaybackAudience;
  exp: number;
};

const PLAYBACK_BUCKET_SEC = 5 * 60;
const PLAYBACK_GRACE_SEC = 10 * 60;

function getPlaybackSecret(override?: string): string {
  const secret = override?.trim() || process.env.STREAM_PLAYBACK_SECRET?.trim();
  if (!secret || secret.length < 32 || secret.startsWith("replace-me")) {
    throw new Error("Stream playback is unavailable.");
  }
  return secret;
}

export function signPlaybackToken(
  input: Omit<PlaybackCapability, "version" | "exp">,
  options?: { nowSec?: number; secret?: string },
): string {
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const payload: PlaybackCapability = {
    version: 1,
    ...input,
    // Quantizing prevents the public-status poll from replacing the player URL
    // every five seconds while still keeping the capability short-lived.
    exp:
      Math.ceil(nowSec / PLAYBACK_BUCKET_SEC) * PLAYBACK_BUCKET_SEC +
      PLAYBACK_GRACE_SEC,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", getPlaybackSecret(options?.secret))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyPlaybackToken(
  token: string,
  options?: {
    nowSec?: number;
    secret?: string;
    churchId?: string;
    eventId?: string;
    audience?: PlaybackAudience;
  },
): PlaybackCapability | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || token.length > 2048) return null;

  const expected = createHmac("sha256", getPlaybackSecret(options?.secret))
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
    ) as Partial<PlaybackCapability>;
    const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
    if (
      payload.version !== 1 ||
      !payload.churchId ||
      !payload.eventId ||
      (payload.audience !== "public" && payload.audience !== "staff") ||
      typeof payload.exp !== "number" ||
      payload.exp <= nowSec ||
      (options?.churchId && payload.churchId !== options.churchId) ||
      (options?.eventId && payload.eventId !== options.eventId) ||
      (options?.audience && payload.audience !== options.audience)
    ) {
      return null;
    }
    return payload as PlaybackCapability;
  } catch {
    return null;
  }
}

export function getHlsPlaybackUrl(input: {
  churchId: string;
  eventId: string;
  audience: PlaybackAudience;
}): string {
  const capability = signPlaybackToken(input);
  const base = absoluteAppPath(
    `/api/stream/hls/${encodeURIComponent(input.churchId)}/index.m3u8`,
  );
  return `${base}?cap=${encodeURIComponent(capability)}`;
}
