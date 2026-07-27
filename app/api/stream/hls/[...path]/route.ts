import { NextRequest, NextResponse } from "next/server";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import { isAbortError, startStreamTimer } from "@/lib/stream/telemetry";

// Media proxying must never be statically optimized or cached at build time.
export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.STREAM_HLS_UPSTREAM_URL?.trim() ||
  "http://stream.faithform.io:8888";

/**
 * Media segments are immutable for as long as a live playlist references them.
 * A short shared TTL lets the CDN collapse many concurrent viewers onto one
 * origin fetch per segment instead of invoking this function once per viewer
 * per segment — without risking long-lived stale media if the relay restarts
 * and reuses segment names.
 */
const SEGMENT_CACHE_CONTROL = "public, max-age=30, s-maxage=30";
const NO_STORE = "no-cache, no-store, must-revalidate";

const SEGMENT_EXTENSIONS = [".ts", ".m4s", ".mp4", ".aac", ".vtt"];

function contentTypeFor(path: string, upstreamType: string | null): string {
  if (upstreamType) return upstreamType;
  if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".m4s") || path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  const segments = params.path ?? [];
  const timer = startStreamTimer({
    route: "stream/hls",
    kind: segments.at(-1)?.endsWith(".m3u8") ? "playlist" : "segment",
    // Segment traffic is very high volume: sample successes, keep every error.
    sampleRate: 0.01,
  });

  if (segments.length === 0) {
    timer.end("error", { category: "bad_request", status: 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The joined path is interpolated into an upstream URL, so reject traversal
  // and absolute-URL smuggling rather than trusting normalization.
  if (
    segments.some(
      (s) => s === "." || s === ".." || s.includes("\\") || s.includes(":"),
    )
  ) {
    timer.end("error", { category: "bad_request", status: 400 });
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const upstreamPath = segments.map(encodeURIComponent).join("/");
  const isPlaylist = upstreamPath.endsWith(".m3u8");
  const isSegment = SEGMENT_EXTENSIONS.some((ext) => upstreamPath.endsWith(ext));
  const upstreamUrl = `${UPSTREAM.replace(/\/$/, "")}/${upstreamPath}${request.nextUrl.search}`;

  const range = request.headers.get("range");

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      // Propagate viewer disconnects so we stop pulling from the relay as soon
      // as nobody is waiting for the bytes.
      signal: request.signal,
      headers: {
        Accept: request.headers.get("accept") ?? "*/*",
        ...(range ? { Range: range } : {}),
      },
    });
  } catch (error) {
    if (isAbortError(error) || request.signal.aborted) {
      timer.end("aborted", { category: "client_abort" });
      return new NextResponse(null, { status: 499 });
    }
    timer.end("error", { category: "upstream_unreachable", status: 502 });
    return NextResponse.json(
      { error: "HLS upstream unreachable" },
      { status: 502 },
    );
  }

  timer.mark("upstream_headers");

  const contentType = contentTypeFor(
    upstreamPath,
    upstream.headers.get("content-type"),
  );

  // Playlists are small and must be rewritten so segment URLs point back here,
  // so buffering them is both necessary and cheap.
  if (isPlaylist && upstream.ok) {
    const text = await upstream.text();
    timer.mark("playlist_read");
    const rewritten = rewriteM3u8Playlist(text, request.nextUrl.pathname);

    timer.end("ok", { status: upstream.status, bytes: rewritten.length });
    return new NextResponse(rewritten, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": NO_STORE,
        "Access-Control-Allow-Origin": "*",
        "X-Stream-Request-Id": timer.requestId,
      },
    });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "X-Stream-Request-Id": timer.requestId,
    // Only cache successful immutable media; never cache an upstream error.
    "Cache-Control":
      upstream.ok && isSegment ? SEGMENT_CACHE_CONTROL : NO_STORE,
  });

  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  timer.end("ok", {
    status: upstream.status,
    bytes: Number(upstream.headers.get("content-length")) || undefined,
  });

  // Pass the body straight through instead of buffering the whole segment:
  // lower time-to-first-byte per segment and flat memory use per invocation.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
