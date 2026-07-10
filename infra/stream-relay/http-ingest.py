#!/usr/bin/env python3
"""HTTP chunked browser ingest → ffmpeg → local RTMP (MediaMTX)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import signal
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

FFMPEG = Path(os.environ.get("FFMPEG_PATH", Path.home() / "bin" / "ffmpeg"))
HOST = os.environ.get("HTTP_INGEST_HOST", "127.0.0.1")
PORT = int(os.environ.get("HTTP_INGEST_PORT", "8090"))
RTMP_BASE = os.environ.get("RTMP_BASE", "rtmp://127.0.0.1:1935/live")
SECRET = os.environ.get("STREAM_RELAY_WEBHOOK_SECRET", "")


def verify_token(token: str) -> tuple[str, str] | None:
    if not SECRET or "." not in token:
        return None

    body_b64, sig = token.split(".", 1)
    try:
        padding = "=" * (-len(body_b64) % 4)
        body = base64.urlsafe_b64decode(body_b64 + padding).decode("utf-8")
    except Exception:
        return None

    expected = hmac.new(
        SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_b64 = base64.urlsafe_b64encode(expected).decode("utf-8").rstrip("=")
    if not hmac.compare_digest(expected_b64, sig.rstrip("=")):
        return None

    parts = body.split(":")
    if len(parts) != 3:
        return None

    church_id, publish_key, exp_str = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return None

    if exp < int(time.time()) or not church_id or not publish_key:
        return None

    return church_id, publish_key


class IngestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        token = parse_qs(parsed.query).get("token", [""])[0]
        verified = verify_token(token)
        if not verified:
            self.send_error(401, "Unauthorized")
            return

        church_id, publish_key = verified
        rtmp_url = f"{RTMP_BASE}/{church_id}/{publish_key}"
        print(f"[http-ingest] starting {church_id}", flush=True)

        cmd = [
            str(FFMPEG),
            "-loglevel",
            "warning",
            "-fflags",
            "nobuffer",
            "-probesize",
            "32",
            "-analyzeduration",
            "0",
            "-f",
            "webm",
            "-i",
            "pipe:0",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-tune",
            "zerolatency",
            "-g",
            "30",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-f",
            "flv",
            rtmp_url,
        ]

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        try:
            while True:
                chunk = self.rfile.read(65536)
                if not chunk:
                    break
                assert proc.stdin is not None
                proc.stdin.write(chunk)
        except Exception as exc:
            print(f"[http-ingest] stream error: {exc}", flush=True)
        finally:
            if proc.stdin is not None:
                proc.stdin.close()
            proc.wait()
            if proc.stderr is not None:
                err = proc.stderr.read().decode("utf-8", errors="ignore").strip()
                if err:
                    print(f"[http-ingest] ffmpeg: {err}", flush=True)
            print(f"[http-ingest] finished {church_id} code={proc.returncode}", flush=True)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Connection", "close")
        self._send_cors()
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, format: str, *args) -> None:
        return


def main() -> None:
    if not SECRET:
        raise SystemExit("STREAM_RELAY_WEBHOOK_SECRET is required")

    server = ThreadingHTTPServer((HOST, PORT), IngestHandler)
    print(f"[http-ingest] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: exit(0))
    main()
