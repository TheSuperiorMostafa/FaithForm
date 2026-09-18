#!/usr/bin/env python3
"""Local MediaMTX auth bridge that keeps relay credentials out of URLs."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


HOST = "127.0.0.1"
PORT = int(os.environ.get("STREAM_AUTH_PROXY_PORT", "8091"))
APP_URL = os.environ.get("FAITHFORM_APP_URL", "").rstrip("/")
SECRET = os.environ.get("STREAM_RELAY_WEBHOOK_SECRET", "")
MAX_BODY = 64 * 1024

# How long a successful playback read is remembered. See read_cache_key.
READ_CACHE_SECONDS = float(os.environ.get("STREAM_AUTH_READ_CACHE_SECONDS", "120"))
READ_CACHE_MAX = 256
_read_cache: dict[str, tuple[float, bytes]] = {}
_read_cache_lock = threading.Lock()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, _req, _fp, _code, _msg, _headers, _newurl):
        return None


OPENER = build_opener(NoRedirect)


def read_cache_key(payload: object) -> str | None:
    """A cache key for a playback read, or None for anything else.

    MediaMTX asks this bridge about every HLS request — every playlist and
    every segment — and FaithForm answers a read by the playback proxy by
    comparing one static secret. Asking it across the internet each time added
    up to a second per request, which was long enough for live segments to be
    deleted before they were served. So a *yes* to such a read is remembered
    for READ_CACHE_SECONDS.

    Publishing is never cached: it presents a per-church, short-lived capability
    that must be checked every time. Refusals are never cached either. The key
    hashes the credential rather than holding it.
    """
    if not isinstance(payload, dict):
        return None
    if payload.get("action") not in ("read", "playback"):
        return None
    if payload.get("user") != "faithform-playback":
        return None
    material = json.dumps(
        [
            payload.get("user"),
            payload.get("password"),
            payload.get("action"),
            payload.get("protocol"),
            payload.get("path"),
        ],
        separators=(",", ":"),
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def cached_read(key: str) -> bytes | None:
    now = time.monotonic()
    with _read_cache_lock:
        entry = _read_cache.get(key)
        if entry is None:
            return None
        expires_at, body = entry
        if expires_at <= now:
            del _read_cache[key]
            return None
        return body


def remember_read(key: str, body: bytes) -> None:
    if READ_CACHE_SECONDS <= 0:
        return
    with _read_cache_lock:
        if len(_read_cache) >= READ_CACHE_MAX:
            _read_cache.pop(next(iter(_read_cache)))
        _read_cache[key] = (time.monotonic() + READ_CACHE_SECONDS, body)


class AuthHandler(BaseHTTPRequestHandler):
    server_version = "FaithFormAuthProxy/1"

    def log_message(self, _format: str, *_args) -> None:
        # MediaMTX bodies can contain short-lived capabilities. Do not log them.
        return

    def send_json(self, status: int, payload: dict) -> None:
        self.send_body(status, json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    def send_body(self, status: int, body: bytes) -> None:
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
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid request"})
            return

        key = read_cache_key(payload)
        if key is not None:
            remembered = cached_read(key)
            if remembered is not None:
                self.send_body(200, remembered)
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

        if key is not None and status == 200:
            remember_read(key, response_body)

        self.send_body(status, response_body)


def main() -> None:
    if not APP_URL.startswith("https://"):
        raise SystemExit("FAITHFORM_APP_URL must use HTTPS")
    if len(SECRET) < 32:
        raise SystemExit("STREAM_RELAY_WEBHOOK_SECRET is required")
    server = ThreadingHTTPServer((HOST, PORT), AuthHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
