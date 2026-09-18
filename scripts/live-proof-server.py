#!/usr/bin/env python3
"""
Serves the live-playback proof: a live HLS stream, and just enough of the
FaithForm media API to play it through the apps' real client code.

  GET  /api/media/v1/live/...           the stream files, as written by ffmpeg
  GET  /api/mobile/v1/media/grace/live  a live projection saying it is on
  POST /api/mobile/v1/media/playback    a grant whose delivery URL is the stream

Used by scripts/verify-ios-live-playback.sh and verify-android-live-playback.sh.
Local only, never deployed, and it checks no credentials — the delivery route's
authorization is covered by tests/unit/media-delivery-token.test.ts.

    live-proof-server.py <root> <port> <route>
"""
import datetime
import functools
import http.server
import json
import sys

ROOT, PORT, ROUTE = sys.argv[1], int(sys.argv[2]), sys.argv[3]

META = {
    "apiVersion": "1.0",
    "apiMajor": 1,
    "requestId": "live-proof",
    "minimumSupportedClientBuild": 1,
}

LIVE = {
    "state": "live",
    "mediaId": "e1",
    "kind": "live",
    "title": "Sunday Worship",
    "startsAt": "2026-09-20T14:00:00Z",
    "countdownEnabled": False,
    "posterUrl": None,
    "publicationVersion": 1,
    "churchSlug": "grace",
    "churchName": "Grace Community",
    "churchTimezone": "America/New_York",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".m3u8": "application/vnd.apple.mpegurl",
        ".ts": "video/mp2t",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass

    def _json(self, data):
        body = json.dumps({"ok": True, "data": data, "meta": META}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/mobile/v1/media/grace/live":
            return self._json({"live": LIVE, "mediaVersion": 1})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] == "/api/mobile/v1/media/playback":
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            expires = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=5)
            return self._json({
                "capability": "FFM1.proof.signature",
                "expiresAt": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "deliveryUrl": f"{ROUTE}/index.m3u8",
                "kind": "live",
                "renditionKind": "hls",
                "mediaId": "e1",
                "refreshAfterSeconds": 60,
                "startOffsetSeconds": 0,
            })
        self.send_error(404)


http.server.ThreadingHTTPServer(
    ("127.0.0.1", PORT), functools.partial(Handler, directory=ROOT)
).serve_forever()
