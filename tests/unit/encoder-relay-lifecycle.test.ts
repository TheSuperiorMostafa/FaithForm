import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { verifyRelaySignature } from "@/lib/stream/relay-auth";

test("RTMP hooks sign the connection identity without the stream key", () => {
  const secret = "test-relay-secret-with-at-least-32-characters";
  const sourceId = "544cbe21-63a9-4e85-a751-a7d929de71d8";
  const path = "live/e5e9114e-e18c-485b-8c60-9041df959e18";
  const harness = `
import json, os, runpy, sys, urllib.request

sys.path.insert(0, "infra/stream-relay")
sender = runpy.run_path("infra/stream-relay/encoder-lifecycle.py")
requests = []

class Response:
    def __enter__(self): return self
    def __exit__(self, *args): return False

def capture(request, timeout):
    requests.append({
        "url": request.full_url,
        "body": request.data.decode(),
        "headers": {key.lower(): value for key, value in request.header_items()},
    })
    return Response()

urllib.request.urlopen = capture
sender["main"]("publish")
sender["main"]("publish")
os.environ["MTX_SOURCE_TYPE"] = "rtmpsConn"
sender["main"]("unpublish")
os.environ["MTX_SOURCE_TYPE"] = "webRTCSession"
sender["main"]("publish")
os.environ["MTX_SOURCE_TYPE"] = "rtmpConn"
os.environ["MTX_SOURCE_ID"] = "00000000-0000-0000-0000-000000000000"
sender["main"]("publish")
print(json.dumps(requests))
`;
  const run = spawnSync("python3", ["-B", "-c", harness], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      FAITHFORM_APP_URL: "https://example.test",
      STREAM_RELAY_WEBHOOK_SECRET: secret,
      MTX_PATH: path,
      MTX_SOURCE_ID: sourceId,
      MTX_SOURCE_TYPE: "rtmpConn",
      MTX_QUERY: "token=private-church-key",
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const requests = JSON.parse(run.stdout) as Array<{
    url: string;
    body: string;
    headers: Record<string, string>;
  }>;
  assert.deepEqual(
    requests.map(({ body }) => JSON.parse(body)),
    ["publish", "publish", "unpublish"].map((event) => ({ path, event, sourceId })),
  );
  const nonces = new Set<string>();
  for (const { url, body, headers } of requests) {
    assert.equal(url, "https://example.test/api/stream/relay/encoder");
    assert.equal(headers["x-stream-relay-secret"], undefined);
    const nonce = headers["x-faithform-relay-nonce"];
    assert.deepEqual(
      verifyRelaySignature({
        secret,
        signature: headers["x-faithform-relay-signature"],
        timestamp: headers["x-faithform-relay-timestamp"],
        nonce,
        body,
      }),
      { ok: true },
    );
    nonces.add(nonce);
  }
  assert.equal(nonces.size, requests.length);
});
