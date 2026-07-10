import { NextRequest, NextResponse } from "next/server";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";

const UPSTREAM =
  process.env.STREAM_HLS_UPSTREAM_URL?.trim() ||
  "http://stream.faithform.io:8888";

export async function GET(
  request: NextRequest,
  { params }: { params: { path?: string[] } },
) {
  const segments = params.path ?? [];
  if (segments.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upstreamPath = segments.join("/");
  const search = request.nextUrl.search;
  const upstreamUrl = `${UPSTREAM.replace(/\/$/, "")}/${upstreamPath}${search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: { Accept: request.headers.get("accept") ?? "*/*" },
    });
  } catch {
    return NextResponse.json(
      { error: "HLS upstream unreachable" },
      { status: 502 },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ??
    (upstreamPath.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : upstreamPath.endsWith(".ts")
        ? "video/mp2t"
        : "application/octet-stream");

  if (upstreamPath.endsWith(".m3u8") && upstream.ok) {
    const text = await upstream.text();
    const playlistUrl = request.nextUrl.pathname;
    const rewritten = rewriteM3u8Playlist(text, playlistUrl);

    return new NextResponse(rewritten, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
