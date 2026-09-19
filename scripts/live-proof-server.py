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
import time
import pathlib
import struct
import zlib

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
    "presentation": {"presentationId": "p1", "sermonId": "s1", "title": "Sunday slides"},
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
        if self.path.split("?")[0] == "/proof-thumbnail.png":
            def chunk(kind, data):
                return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))
            body = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", 16, 9, 8, 2, 0, 0, 0))
            body += chunk(b"IDAT", zlib.compress((b"\0" + b"\0\xff\0" * 16) * 9)) + chunk(b"IEND", b"")
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] == "/proof-recording.mp4":
            if self.headers.get("Authorization") != "Bearer unused":
                return self.send_error(403)
            path = pathlib.Path(ROOT) / "proof-recording.mp4"
            total = path.stat().st_size
            value = self.headers.get("Range", "bytes=0-").split("=", 1)[-1]
            first, last = value.split("-", 1)
            start, end = int(first), min(int(last) if last else total - 1, total - 1)
            print(f"RECORDING_PROOF_RANGE start={start} end={end} total={total}", flush=True)
            if start > end:
                return self.send_error(416)
            self.send_response(206)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.send_header("Content-Length", str(end - start + 1))
            self.end_headers()
            try:
                with path.open("rb") as video:
                    video.seek(start)
                    remaining = end - start + 1
                    # Enough initial video for normal stall avoidance; only
                    # the unfinished response must not block readiness.
                    initial = video.read(min(4 * 1024 * 1024, remaining))
                    self.wfile.write(initial)
                    self.wfile.flush()
                    remaining -= len(initial)
                    # The old completion-handler loader cannot expose these
                    # first frames until the rest of this response arrives.
                    if remaining:
                        time.sleep(12)
                    while remaining:
                        part = video.read(min(64 * 1024, remaining))
                        if not part:
                            break
                        self.wfile.write(part)
                        remaining -= len(part)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Seeking/stopping cancels the old byte range.
            return
        if self.path.split("?")[0] == "/api/mobile/v1/media/grace/live":
            return self._json({"live": LIVE, "mediaVersion": 1})
        if self.path.split("?")[0] == "/api/mobile/v1/presentations/grace/item/p1":
            return self._json({
                "presentationId": "p1", "sermonId": "s1", "version": 1,
                "title": "Sunday slides", "publishedAt": "2026-09-20T14:00:00Z",
                "pageCount": 1, "contentHash": "proof-slides", "scriptureRefs": [],
                "seriesName": None, "churchSlug": "grace", "churchName": "Grace Community",
                "churchTimezone": "America/New_York", "theme": None, "renditions": {"slides": []},
                "pages": [{"id": "page1", "kind": "title", "title": "Grace in action", "readingOrder": ["title"]}],
            })
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
