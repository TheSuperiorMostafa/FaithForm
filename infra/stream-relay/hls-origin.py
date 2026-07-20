#!/usr/bin/env python3
"""Serve normalized HLS files with CORS on the tunnel's local origin."""

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

ROOT = Path(os.environ.get("HLS_ROOT", "/home/mostafa/mediamtx/public-hls")).resolve()
HOST = os.environ.get("HLS_ORIGIN_HOST", "127.0.0.1")
PORT = int(os.environ.get("HLS_ORIGIN_PORT", "8888"))


class HlsHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def guess_type(self, path):
        if path.endswith(".ts"):
            return "video/mp2t"
        if path.endswith(".m3u8"):
            return "application/vnd.apple.mpegurl"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer((HOST, PORT), HlsHandler).serve_forever()
