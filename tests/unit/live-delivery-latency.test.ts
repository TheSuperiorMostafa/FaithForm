import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ExpiringCache } from "@/lib/cache/expiring-cache";
import {
  DELIVERY_AUTHORIZATION_TTL_MS,
  withCachedAuthorization,
} from "@/lib/media/v1/delivery-cache";

/**
 * A live segment exists on the relay for only a few seconds, and players fetch
 * segments one after another — so every playlist and segment request has to be
 * fast. These pin the pieces that keep it fast.
 */

test("an expiring cache forgets after its lifetime and stays bounded", () => {
  let now = 1_000;
  const cache = new ExpiringCache<string>(500, 2, () => now);

  cache.set("a", "one");
  assert.equal(cache.get("a"), "one");
  now += 499;
  assert.equal(cache.get("a"), "one");
  now += 1;
  assert.equal(cache.get("a"), undefined, "an expired entry is served");

  cache.set("a", "one");
  cache.set("b", "two");
  cache.set("c", "three");
  assert.equal(cache.size, 2);
  assert.equal(cache.get("a"), undefined, "the oldest entry was not evicted first");
  assert.equal(cache.get("c"), "three");
});

test("a positive authorization is reused; a refusal is asked again every time", async () => {
  const cache = new ExpiringCache<{ churchId: string }>(DELIVERY_AUTHORIZATION_TTL_MS);
  let calls = 0;

  const granted = async () => {
    calls += 1;
    return { churchId: "church-1" };
  };
  assert.deepEqual(await withCachedAuthorization(cache, "k", granted), { churchId: "church-1" });
  assert.deepEqual(await withCachedAuthorization(cache, "k", granted), { churchId: "church-1" });
  assert.equal(calls, 1, "the database was asked again within the window");

  let refusals = 0;
  const refused = async () => {
    refusals += 1;
    return null;
  };
  assert.equal(await withCachedAuthorization(cache, "other", refused), null);
  assert.equal(await withCachedAuthorization(cache, "other", refused), null);
  assert.equal(refusals, 2, "a refusal was remembered");
});

test("the live window stays short enough to notice a revocation", () => {
  assert.ok(DELIVERY_AUTHORIZATION_TTL_MS > 0);
  assert.ok(DELIVERY_AUTHORIZATION_TTL_MS <= 30_000);
});

test("the live route authorizes through the cache, keyed by the token's version", () => {
  const route = readFileSync("app/api/media/v1/live/[...path]/route.ts", "utf8");
  assert.match(route, /withCachedAuthorization\(\s*liveAuthorizations,/);
  assert.match(route, /credential\.authorizationVersion \?\? "header"/);
  assert.match(route, /authorizationVersion: credential\.authorizationVersion/);
});

test("the relay path is remembered rather than read per segment", () => {
  const upstream = readFileSync("lib/stream/relay-upstream.ts", "utf8");
  assert.match(upstream, /const streamPath = await streamPathFor\(input\.churchId\)/);
  assert.match(upstream, /if \(settings\.streamPath\) streamPaths\.set/);
});

test("the website player is tuned to the relay's actual segment geometry", () => {
  const config = readFileSync("infra/stream-relay/mediamtx.yml", "utf8");
  const player = readFileSync("lib/stream/hls-player.ts", "utf8");

  const duration = Number(/^hlsSegmentDuration:\s*(\d+)s\s*$/m.exec(config)?.[1]);
  const count = Number(/^hlsSegmentCount:\s*(\d+)\s*$/m.exec(config)?.[1]);
  assert.ok(duration >= 2, "segments shorter than a proxied request can be fetched in");
  assert.ok(duration * count >= 20, "a live window too short to survive a stall");

  assert.match(player, new RegExp(`const RELAY_SEGMENT_SEC = ${duration};`));
  assert.match(player, new RegExp(`const RELAY_PLAYLIST_SEGMENTS = ${count};`));
});

test("the relay auth bridge remembers playback reads and nothing else", () => {
  // Runs the real bridge against a counting stand-in for FaithForm.
  const harness = String.raw`
import importlib.util, json, sys, threading, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

calls = []
class Upstream(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        calls.append(body["action"])
        ok = body.get("user") == "faithform-playback" and body.get("password") == "right"
        status = 200 if ok or body["action"] == "publish" else 401
        payload = b'{"ok":true}' if status == 200 else b'{"error":"no"}'
        self.send_response(status)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
threading.Thread(target=upstream.serve_forever, daemon=True).start()

spec = importlib.util.spec_from_file_location("auth_proxy", "infra/stream-relay/auth-proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)
proxy.APP_URL = "http://127.0.0.1:%d" % upstream.server_address[1]
bridge = ThreadingHTTPServer(("127.0.0.1", 0), proxy.AuthHandler)
threading.Thread(target=bridge.serve_forever, daemon=True).start()

def ask(payload):
    req = urllib.request.Request(
        "http://127.0.0.1:%d/auth" % bridge.server_address[1],
        data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status
    except urllib.error.HTTPError as e: return e.code

read = {"user": "faithform-playback", "password": "right", "action": "read", "protocol": "hls", "path": "live/x"}
wrong = dict(read, password="wrong")
publish = {"user": "", "password": "cap", "action": "publish", "protocol": "rtmp", "path": "live/x"}
results = [ask(read), ask(read), ask(read), ask(wrong), ask(wrong), ask(publish), ask(publish)]
print(json.dumps({"results": results, "calls": calls}))
`;
  const run = spawnSync("python3", ["-c", harness], { encoding: "utf8", timeout: 20_000 });
  assert.equal(run.status, 0, run.stderr);
  const { results, calls } = JSON.parse(run.stdout.trim()) as { results: number[]; calls: string[] };

  assert.deepEqual(results, [200, 200, 200, 401, 401, 200, 200]);
  // Three identical playback reads cost one round trip to FaithForm; the wrong
  // password is asked about every time, and so is every publish.
  assert.deepEqual(calls, ["read", "read", "read", "publish", "publish"]);
});
