#!/usr/bin/env node
/**
 * Repeatable verification for the HLS proxy at /api/stream/hls/[...path].
 *
 * Runs a mock relay upstream, points the app at it, and asserts the proxy's
 * observable contract: playlist rewriting, cache policy, range support,
 * traversal rejection, error pass-through, and — most importantly — that
 * segment bodies are streamed rather than buffered.
 *
 * Usage:
 *   node scripts/verify-stream-proxy.mjs                  # against pnpm start
 *   APP_URL=http://localhost:3000 node scripts/verify-stream-proxy.mjs
 *
 * The app under test must run with:
 *   STREAM_HLS_UPSTREAM_URL=http://127.0.0.1:<UPSTREAM_PORT>
 */

import http from "node:http";

const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT ?? 3101);
const APP_URL = (process.env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");

/** Bytes per drip and delay between drips for the slow-segment test. */
const DRIP_CHUNK = 16 * 1024;
const DRIP_COUNT = 8;
const DRIP_DELAY_MS = 150;

const PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:1",
  "#EXT-X-MEDIA-SEQUENCE:42",
  "#EXTINF:1.000,",
  "seg42.ts",
  "#EXTINF:1.000,",
  "seg43.ts",
  "#EXT-X-ENDLIST",
  "",
].join("\n");

let results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function startUpstream() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${UPSTREAM_PORT}`);
    const path = url.pathname;

    if (path.endsWith("index.m3u8")) {
      res.writeHead(200, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Content-Length": Buffer.byteLength(PLAYLIST),
      });
      res.end(PLAYLIST);
      return;
    }

    // A segment delivered slowly, to prove the proxy forwards bytes as they
    // arrive instead of accumulating the whole body first.
    if (path.endsWith("slow.ts")) {
      res.writeHead(200, {
        "Content-Type": "video/mp2t",
        "Content-Length": String(DRIP_CHUNK * DRIP_COUNT),
      });
      let sent = 0;
      const tick = () => {
        if (sent >= DRIP_COUNT) return res.end();
        res.write(Buffer.alloc(DRIP_CHUNK, sent));
        sent += 1;
        setTimeout(tick, DRIP_DELAY_MS);
      };
      tick();
      return;
    }

    if (path.endsWith("seg42.ts")) {
      const body = Buffer.alloc(4096, 7);
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-(\d+)?/.exec(range);
        const start = Number(m?.[1] ?? 0);
        const end = Number(m?.[2] ?? body.length - 1);
        const slice = body.subarray(start, end + 1);
        res.writeHead(206, {
          "Content-Type": "video/mp2t",
          "Content-Range": `bytes ${start}-${end}/${body.length}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(slice.length),
        });
        res.end(slice);
        return;
      }
      res.writeHead(200, {
        "Content-Type": "video/mp2t",
        "Content-Length": String(body.length),
      });
      res.end(body);
      return;
    }

    if (path.endsWith("broken.ts")) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("upstream exploded");
      return;
    }

    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(UPSTREAM_PORT, "127.0.0.1", () => resolve(server));
  });
}

async function testPlaylist() {
  const res = await fetch(`${APP_URL}/api/stream/hls/live/church/key/index.m3u8`);
  const body = await res.text();

  check("playlist: 200", res.status === 200, `got ${res.status}`);
  check(
    "playlist: HLS content-type",
    (res.headers.get("content-type") ?? "").includes("mpegurl"),
    res.headers.get("content-type") ?? "none",
  );
  check(
    "playlist: not cached",
    (res.headers.get("cache-control") ?? "").includes("no-store"),
    res.headers.get("cache-control") ?? "none",
  );
  check(
    "playlist: segment URLs rewritten through the proxy",
    body.includes("/api/stream/hls/live/church/key/seg42.ts"),
  );
  check(
    "playlist: ENDLIST stripped so brief ingest drops do not end playback",
    !body.includes("#EXT-X-ENDLIST"),
  );
  check("playlist: carries a request id", Boolean(res.headers.get("x-stream-request-id")));
}

async function testSegmentCaching() {
  const res = await fetch(`${APP_URL}/api/stream/hls/live/church/key/seg42.ts`);
  const buf = Buffer.from(await res.arrayBuffer());
  const cc = res.headers.get("cache-control") ?? "";

  check("segment: 200", res.status === 200, `got ${res.status}`);
  check("segment: body intact", buf.length === 4096, `${buf.length} bytes`);
  check(
    "segment: shared-cacheable so concurrent viewers collapse to one origin fetch",
    cc.includes("max-age=30") && !cc.includes("no-store"),
    cc || "none",
  );
}

async function testRange() {
  const res = await fetch(`${APP_URL}/api/stream/hls/live/church/key/seg42.ts`, {
    headers: { Range: "bytes=0-99" },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  check("range: 206 passthrough", res.status === 206, `got ${res.status}`);
  check("range: 100 bytes returned", buf.length === 100, `${buf.length} bytes`);
  check(
    "range: content-range preserved",
    Boolean(res.headers.get("content-range")),
    res.headers.get("content-range") ?? "none",
  );
}

async function testStreamingNotBuffering() {
  const started = performance.now();
  const res = await fetch(`${APP_URL}/api/stream/hls/live/church/key/slow.ts`);
  const reader = res.body.getReader();

  const { value: first } = await reader.read();
  const ttfb = performance.now() - started;

  let total = first?.length ?? 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
  }
  const complete = performance.now() - started;

  const upstreamFullDelivery = DRIP_DELAY_MS * DRIP_COUNT;

  check(
    "streaming: all bytes delivered",
    total === DRIP_CHUNK * DRIP_COUNT,
    `${total} of ${DRIP_CHUNK * DRIP_COUNT}`,
  );
  // If the route buffered the whole segment, first byte could not arrive until
  // the upstream finished dripping.
  check(
    "streaming: first byte arrives before upstream finishes (not buffered)",
    ttfb < upstreamFullDelivery * 0.6,
    `ttfb=${ttfb.toFixed(0)}ms, upstream full delivery≈${upstreamFullDelivery}ms, complete=${complete.toFixed(0)}ms`,
  );
}

async function testTraversalRejected() {
  const res = await fetch(`${APP_URL}/api/stream/hls/live/..%2F..%2Fetc/passwd`, {
    redirect: "manual",
  });
  check(
    "security: traversal attempt rejected",
    res.status === 400 || res.status === 404,
    `got ${res.status}`,
  );
}

async function testUpstreamErrorNotCached() {
  const res = await fetch(`${APP_URL}/api/stream/hls/live/church/key/broken.ts`);
  const cc = res.headers.get("cache-control") ?? "";
  check("error: upstream 500 surfaced", res.status === 500, `got ${res.status}`);
  check("error: failure not cached", cc.includes("no-store"), cc || "none");
}

async function main() {
  const upstream = await startUpstream();
  console.log(`mock relay listening on http://127.0.0.1:${UPSTREAM_PORT}`);
  console.log(`testing app at ${APP_URL}\n`);

  try {
    const probe = await fetch(`${APP_URL}/api/stream/hls/live/church/key/index.m3u8`).catch(
      () => null,
    );
    if (!probe) {
      throw new Error(
        `App not reachable at ${APP_URL}. Start it with:\n` +
          `  STREAM_HLS_UPSTREAM_URL=http://127.0.0.1:${UPSTREAM_PORT} PORT=3100 pnpm start`,
      );
    }

    console.log("playlist");
    await testPlaylist();
    console.log("\nsegment caching");
    await testSegmentCaching();
    console.log("\nrange requests");
    await testRange();
    console.log("\nincremental delivery");
    await testStreamingNotBuffering();
    console.log("\nsecurity");
    await testTraversalRejected();
    console.log("\nupstream failure");
    await testUpstreamErrorNotCached();
  } finally {
    upstream.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error("\nFAILED:");
    for (const f of failed) console.error(`  - ${f.name} (${f.detail})`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
