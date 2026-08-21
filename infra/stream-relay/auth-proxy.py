#!/usr/bin/env python3
"""Local MediaMTX auth bridge that keeps relay credentials out of URLs."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


HOST = "127.0.0.1"
PORT = int(os.environ.get("STREAM_AUTH_PROXY_PORT", "8091"))
APP_URL = os.environ.get("FAITHFORM_APP_URL", "").rstrip("/")
SECRET = os.environ.get("STREAM_RELAY_WEBHOOK_SECRET", "")
MAX_BODY = 64 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
        return None


OPENER = build_opener(NoRedirect)


class AuthHandler(BaseHTTPRequestHandler):
    server_version = "FaithFormAuthProxy/1"

    def log_message(self, _format: str, *_args) -> None:
        # MediaMTX bodies can contain short-lived capabilities. Do not log them.
        return

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/auth":
            self.send_json(404, {"error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 1 or length > MAX_BODY:
            self.send_json(400, {"error": "Invalid request"})
            return

        body = self.rfile.read(length)
        try:
            json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid request"})
            return

        request = Request(
            f"{APP_URL}/api/stream/publish-auth",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Stream-Relay-Secret": SECRET,
            },
            method="POST",
        )
        try:
            with OPENER.open(request, timeout=10) as response:
                status = response.status
                response_body = response.read(MAX_BODY)
        except HTTPError as error:
            status = error.code
            response_body = error.read(MAX_BODY)
        except Exception:
            self.send_json(503, {"error": "Unavailable"})
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)


def main() -> None:
    if not APP_URL.startswith("https://"):
        raise SystemExit("FAITHFORM_APP_URL must use HTTPS")
    if len(SECRET) < 32:
        raise SystemExit("STREAM_RELAY_WEBHOOK_SECRET is required")
    server = ThreadingHTTPServer((HOST, PORT), AuthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
