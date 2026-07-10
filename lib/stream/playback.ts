import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { absoluteAppPath } from "@/lib/site-url";
import { buildStreamPath, getStreamRelaySettings } from "@/lib/stream/relay";

const PLAYBACK_TTL_SEC = 3600;

function getPlaybackSecret(): string {
  const secret =
    process.env.STREAM_PLAYBACK_SECRET?.trim() ??
    process.env.STREAM_RELAY_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing STREAM_PLAYBACK_SECRET or STREAM_RELAY_WEBHOOK_SECRET");
  }
  return secret;
}

export function signPlaybackToken(churchId: string, publishKey: string): string {
  const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_SEC;
  const body = `${churchId}:${publishKey}:${exp}`;
  const sig = createHmac("sha256", getPlaybackSecret())
    .update(body)
    .digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${sig}`;
}

export function verifyPlaybackToken(token: string): {
  churchId: string;
  publishKey: string;
} | null {
  const [bodyB64, sig] = token.split(".");
  if (!bodyB64 || !sig) return null;

  const body = Buffer.from(bodyB64, "base64url").toString("utf8");
  const expected = createHmac("sha256", getPlaybackSecret())
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

export async function getHlsPlaybackUrl(
  churchId: string,
  options?: { supabase?: SupabaseClient; publicAccess?: boolean },
): Promise<string | null> {
  const settings = await getStreamRelaySettings(churchId, {
    includeSecret: true,
    supabase: options?.supabase,
  });

  if (!settings.publishKey || !settings.streamPath) return null;

  const hlsBase =
    process.env.NEXT_PUBLIC_STREAM_HLS_BASE_URL?.trim() ||
    absoluteAppPath("/api/stream/hls");

  return `${hlsBase.replace(/\/$/, "")}/${settings.streamPath}/index.m3u8`;
}

export function getRelayHlsPath(churchId: string, publishKey: string): string {
  return buildStreamPath(churchId, publishKey);
}
