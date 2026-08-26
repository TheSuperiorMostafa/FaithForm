import { getStreamRelaySettings } from "@/lib/stream/relay";

/**
 * Reaching the relay, in one place.
 *
 * Two routes now proxy HLS: the website's `/api/stream/hls/[...path]`, which
 * authenticates with a query-string capability because that is what an
 * `hls.js` player in a browser can carry, and Faithful's
 * `/api/media/v1/live/[...path]`, which authenticates with a bearer header
 * because that is what a native player can carry without putting a credential
 * in a URL.
 *
 * They differ in **who is allowed to ask**. They must not differ in *how the
 * relay is reached*: the upstream base, the server-side Basic credential, the
 * path derivation and the segment-name validation are one contract, and having
 * two copies of it would mean two places to forget a rule.
 *
 * **The relay credential never leaves this process.** It is assembled here and
 * attached to an outbound request; nothing returns it, and no response carries
 * it. That is Prompt 2's protection and this module preserves it exactly.
 */

const NO_STORE = "private, no-cache, no-store, must-revalidate";

export function relayCacheHeader(): string {
  return NO_STORE;
}

function upstreamBase(): string | null {
  const value = process.env.STREAM_HLS_UPSTREAM_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

/**
 * The relay's own Basic credential.
 *
 * Returns null rather than throwing so a caller answers 503 instead of leaking
 * a stack, and so an unconfigured deployment fails closed.
 */
function playbackAuthorization(): string | null {
  const secret = process.env.STREAM_RELAY_PLAYBACK_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return `Basic ${Buffer.from(`faithform-playback:${secret}`).toString("base64")}`;
}

export function contentTypeFor(path: string, upstreamType: string | null): string {
  if (upstreamType) return upstreamType;
  if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".m4s") || path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

/**
 * Whether every segment of a requested media path is safe to forward.
 *
 * Traversal, drive letters and Windows separators are refused. A path is
 * *appended* to the church's own relay path, so a segment that escaped it would
 * read another church's stream.
 */
export function segmentsAreSafe(segments: string[]): boolean {
  return (
    segments.length > 0 &&
    !segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        segment.includes(":"),
    )
  );
}

export type RelayFetch =
  | { ok: true; response: Response; upstreamPath: string }
  | { ok: false; reason: "unconfigured" | "no_stream_path" | "aborted" | "unreachable" };

/**
 * Fetches one playlist or segment from the relay.
 *
 * The church's relay path comes from `getStreamRelaySettings`, never from the
 * request — the caller supplies only the media segments below it.
 */
export async function fetchFromRelay(input: {
  churchId: string;
  mediaSegments: string[];
  accept: string | null;
  range: string | null;
  signal: AbortSignal;
}): Promise<RelayFetch> {
  const base = upstreamBase();
  const authorization = playbackAuthorization();
  if (!base || !authorization) return { ok: false, reason: "unconfigured" };

  const settings = await getStreamRelaySettings(input.churchId, {
    includeSecret: false,
    includeInternalPath: true,
  });
  if (!settings.streamPath) return { ok: false, reason: "no_stream_path" };

  const mediaPath = input.mediaSegments.map(encodeURIComponent).join("/");
  const upstreamPath = `${settings.streamPath}/${mediaPath}`;

  try {
    const response = await fetch(`${base}/${upstreamPath}`, {
      cache: "no-store",
      redirect: "manual",
      signal: input.signal,
      headers: {
        Accept: input.accept ?? "*/*",
        Authorization: authorization,
        ...(input.range ? { Range: input.range } : {}),
      },
    });
    return { ok: true, response, upstreamPath };
  } catch (error) {
    if (input.signal.aborted) return { ok: false, reason: "aborted" };
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "unreachable" };
  }
}
