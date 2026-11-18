"""Callback client for the dashboard worker routes (see docs/sermon-media/WORKER_CONTRACT.md).

Never log the job token or any signed URL. Every exception raised from here has its
text passed through `redact`.
"""
from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Iterable

log = logging.getLogger("sermon_media")

_URL_RE = re.compile(r"https?://[^\s'\"<>]+")
_BEARER_RE = re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+")
_QUERY_SECRET_RE = re.compile(r"(?i)(token|sig|signature|key|secret)=[^&\s'\"]+")


def redact(text: object, secrets: Iterable[str] = ()) -> str:
    """Remove secrets, bearer tokens and URLs (signed URLs carry tokens) from text."""
    out = str(text)
    for s in secrets:
        if s and len(s) >= 6:
            out = out.replace(s, "[redacted]")
    out = _BEARER_RE.sub("Bearer [redacted]", out)
    out = _URL_RE.sub("[url]", out)
    return _QUERY_SECRET_RE.sub(r"\1=[redacted]", out)


class CallbackError(Exception):
    """Callback could not be delivered (after retries, or a non-retryable 4xx)."""


class StopJob(Exception):
    """The dashboard told us to stop. Exit cleanly; do not call `fail`."""

    reason = "stop"


class Stale(StopJob):
    reason = "stale"


class Cancelled(StopJob):
    reason = "cancelled"


class Unauthorized(StopJob):
    reason = "unauthorized"


class CallbackClient:
    def __init__(
        self,
        callback_base: str,
        job_token: str,
        attempt_id: str,
        *,
        timeout: float = 30.0,
        max_tries: int = 5,
        backoff: float = 1.0,
        max_backoff: float = 20.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self._base = callback_base.rstrip("/")
        self._token = job_token
        self.attempt_id = attempt_id
        self.timeout = timeout
        self.max_tries = max_tries
        self.backoff = backoff
        self.max_backoff = max_backoff
        self._sleep = sleep
        self._lock = threading.Lock()  # heartbeat thread shares the client

    def redact(self, text: object) -> str:
        return redact(text, [self._token, self._base])

    def post(self, name: str, body: dict | None = None) -> dict:
        payload = dict(body or {})
        payload["attempt_id"] = self.attempt_id
        data = json.dumps(payload, separators=(",", ":")).encode()
        last = "no attempt"
        for attempt in range(1, self.max_tries + 1):
            req = urllib.request.Request(
                f"{self._base}/{name}",
                data=data,
                method="POST",
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    raw = resp.read()
                return json.loads(raw) if raw else {}
            except urllib.error.HTTPError as e:
                status = e.code
                try:
                    detail = json.loads(e.read() or b"{}")
                except Exception:
                    detail = {}
                if status == 409:
                    if detail.get("status") == "cancelled":
                        raise Cancelled(f"{name}: cancelled") from None
                    raise Stale(f"{name}: stale") from None
                if status in (401, 403):
                    raise Unauthorized(f"{name}: unauthorized ({status})") from None
                if status < 500 and status != 429:
                    raise CallbackError(f"{name}: rejected with HTTP {status}") from None
                last = f"HTTP {status}"
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last = self.redact(type(e).__name__ + ": " + str(getattr(e, "reason", e)))
            except ValueError:
                raise CallbackError(f"{name}: invalid JSON response") from None
            if attempt < self.max_tries:
                delay = min(self.max_backoff, self.backoff * 2 ** (attempt - 1))
                log.warning("callback %s failed (%s), retry %d", name, last, attempt)
                self._sleep(delay * (0.75 + random.random() * 0.5))
        raise CallbackError(f"{name}: failed after {self.max_tries} tries ({last})")


class Heartbeat:
    """Background heartbeat (default every 30 s; contract requires <= 60 s).

    The main thread updates stage/progress with `update()` and calls `check()` between
    steps; `check()` re-raises Stale/Cancelled/Unauthorized seen by the heartbeat.
    Transient heartbeat failures are tolerated (the next beat retries).
    """

    def __init__(self, client: CallbackClient, interval: float = 30.0):
        self.client = client
        self.interval = min(interval, 45.0)
        self.stage = "starting"
        self.progress = 0.0
        self.stop_error: StopJob | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="heartbeat", daemon=True)

    def update(self, stage: str | None = None, progress: float | None = None) -> None:
        if stage is not None:
            self.stage = stage
        if progress is not None:
            self.progress = max(0.0, min(1.0, float(progress)))
        self.check()

    def check(self) -> None:
        if self.stop_error is not None:
            raise self.stop_error

    def beat(self) -> None:
        try:
            self.client.post(
                "heartbeat", {"stage": self.stage, "progress": round(self.progress, 3)}
            )
        except StopJob as e:
            self.stop_error = e
            self._stop.set()
        except CallbackError as e:
            log.warning("heartbeat failed: %s", self.client.redact(e))

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            self.beat()

    def __enter__(self) -> "Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._thread.join(timeout=5)
