#!/usr/bin/env python3
"""WebSocket browser ingest → ffmpeg → local RTMP (MediaMTX)."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import signal
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import websockets
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Install websockets: pip3 install --user websockets"
    ) from exc

FFMPEG = Path(os.environ.get("FFMPEG_PATH", Path.home() / "bin" / "ffmpeg"))
HOST = os.environ.get("WS_INGEST_HOST", "127.0.0.1")
PORT = int(os.environ.get("WS_INGEST_PORT", "8090"))
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

    sig_norm = sig.rstrip("=")
    if not hmac.compare_digest(expected_b64, sig_norm):
        return None

    parts = body.split(":")
    if len(parts) != 3:
        return None

    church_id, publish_key, exp_str = parts
    try:
        exp = int(exp_str)
    except ValueError:
        return None

    if exp < int(time.time()):
        return None

    if not church_id or not publish_key:
        return None

    return church_id, publish_key


async def pipe_ffmpeg(ws, rtmp_url: str) -> None:
    cmd = [
        str(FFMPEG),
        "-loglevel",
        "warning",
        "-fflags",
        "+genpts+flush_packets",
        "-flags",
        "+low_delay",
        "-probesize",
        "32",
        "-analyzeduration",
        "0",
        "-f",
        "webm",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        # The studio compositor publishes 1920x1080 (8160 macroblocks at
        # 120x68). Level 3.1 caps out at 3600 macroblocks / 108000 MB per
        # second — i.e. 720p30 — so x264 rejected every frame, ffmpeg died with
        # a broken pipe, and nothing ever reached RTMP. 4.1 covers 1080p30.
        # Main profile also replaces baseline: baseline has no CABAC or
        # B-frames, so it needs noticeably more bitrate for the same quality,
        # and every browser and mobile device in use today decodes main.
        "-profile:v",
        "main",
        "-level",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-r",
        "30",
        # Keyframe every 30 frames at 30fps = one per second, matching
        # hlsSegmentDuration in mediamtx.yml so segments cut on GOP boundaries.
        "-g",
        "30",
        "-keyint_min",
        "30",
        "-sc_threshold",
        "0",
        # Cap the bitrate. Unbounded 1080p CRF output can spike well past what
        # the relay's uplink and the tunnel can carry, which shows up as
        # stuttering rather than as an error.
        "-maxrate",
        "4500k",
        "-bufsize",
        "9000k",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-b:a",
        "128k",
        "-f",
        "flv",
        rtmp_url,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )

    async def read_stderr() -> None:
        assert proc.stderr is not None
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="ignore").strip()
            if text:
                print(f"[ws-ingest] ffmpeg: {text}", flush=True)

    stderr_task = asyncio.create_task(read_stderr())

    try:
        async for message in ws:
            if isinstance(message, bytes):
                assert proc.stdin is not None
                proc.stdin.write(message)
                await proc.stdin.drain()
    finally:
        if proc.stdin is not None:
            proc.stdin.close()
        await proc.wait()
        stderr_task.cancel()
        print(f"[ws-ingest] ffmpeg exited {proc.returncode}", flush=True)


async def handler(ws) -> None:
    request_path = ws.request.path if hasattr(ws, "request") else ws.path
    parsed = urlparse(request_path)
    token = parse_qs(parsed.query).get("token", [""])[0]

    parsed = verify_token(token)
    if not parsed:
        await ws.send(json.dumps({"error": "Unauthorized ingest token."}))
        await ws.close()
        return

    church_id, publish_key = parsed
    rtmp_url = f"{RTMP_BASE}/{church_id}/{publish_key}"
    print(f"[ws-ingest] starting ingest for {church_id}", flush=True)

    await ws.send(json.dumps({"ok": True}))
    await pipe_ffmpeg(ws, rtmp_url)


async def main() -> None:
    if not SECRET:
        raise SystemExit("STREAM_RELAY_WEBHOOK_SECRET is required")

    async with websockets.serve(handler, HOST, PORT, max_size=8 * 1024 * 1024):
        print(f"[ws-ingest] listening on ws://{HOST}:{PORT}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: exit(0))
    asyncio.run(main())
