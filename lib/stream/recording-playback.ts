import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The capability a web player holds to watch a recording.
 *
 * The website's viewers are not signed in and a dashboard preview must not
 * need a session cookie on every segment request, so the playlist URL carries
 * a signed token in its path — the same approach the apps use, under its own
 * sub-key so a web token never verifies as an app token or a live token:
 *
 *     subKey = HMAC(STREAM_PLAYBACK_SECRET, "faithform.recording.web.v1|" + audience)
 *
 * It is not the authorization. The route re-checks on every request that the
 * recording is still published to the website (public) or still belongs to
 * the church (staff), so unpublishing stops a player that is already running.
 */

export type RecordingAudience = "public" | "staff";

type Payload = { v: 1; c: string; r: string; a: RecordingAudience; e: number };

const DOMAIN = "faithform.recording.web.v1";
const PREFIX = "FFR1";

/** Long enough for a full service; the per-request check is what revokes. */
export const RECORDING_WEB_TTL_SECONDS = 6 * 60 * 60;

function secret(): string | null {
  const value = process.env.STREAM_PLAYBACK_SECRET?.trim();
  if (!value || value.length < 32 || value.startsWith("replace-me")) return null;
  return value;
}

function sign(material: string, audience: RecordingAudience, body: string): string {
  const key = createHmac("sha256", material).update(`${DOMAIN}|${audience}`).digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function recordingPlaybackConfigured(): boolean {
  return secret() !== null;
}

export function signRecordingPlaybackToken(input: {
  churchId: string;
  recordingId: string;
  audience: RecordingAudience;
  nowSeconds?: number;
}): string | null {
  const material = secret();
  if (!material) return null;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Quantized so a page that re-renders does not produce a new URL each time.
  const expires = Math.ceil((now + RECORDING_WEB_TTL_SECONDS) / 300) * 300;
  const payload: Payload = { v: 1, c: input.churchId, r: input.recordingId, a: input.audience, e: expires };
  const body = `${PREFIX}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${body}.${sign(material, input.audience, body)}`;
}

export function verifyRecordingPlaybackToken(
  token: string,
  expected: { recordingId: string; nowSeconds?: number },
): { churchId: string; audience: RecordingAudience } | null {
  const material = secret();
  if (!material || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;

  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload?.a !== "public" && payload?.a !== "staff") return null;

  // The audience selects the key, so it is proven by the signature it came with.
  const expectedSignature = Buffer.from(sign(material, payload.a, `${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) {
    return null;
  }

  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    payload.v !== 1 ||
    typeof payload.c !== "string" ||
    payload.r !== expected.recordingId ||
    typeof payload.e !== "number" ||
    payload.e <= now
  ) {
    return null;
  }
  return { churchId: payload.c, audience: payload.a };
}

export function recordingPlaylistPath(recordingId: string, token: string): string {
  return `/api/stream/recordings/${encodeURIComponent(recordingId)}/${token}/index.m3u8`;
}
