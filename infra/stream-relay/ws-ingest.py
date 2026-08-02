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


def clamp(value, low, high, default):
    """Browser-supplied numbers are untrusted; keep them inside sane bounds."""
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


class StreamSettings:
    """What the browser told us it is about to send."""

    def __init__(self, payload: dict | None = None) -> None:
        payload = payload or {}
        self.width = clamp(payload.get("width"), 426, 1920, 1920)
        self.height = clamp(payload.get("height"), 240, 1080, 1080)
        self.fps = clamp(payload.get("fps"), 10, 60, 30)
        self.video_bitrate = clamp(
            payload.get("videoBitrate"), 300_000, 6_000_000, 2_500_000
        )
        self.audio_bitrate = clamp(
            payload.get("audioBitrate"), 32_000, 320_000, 128_000
        )

    def __repr__(self) -> str:
        return (
            f"{self.width}x{self.height}@{self.fps} "
            f"v={self.video_bitrate // 1000}k a={self.audio_bitrate // 1000}k"
        )


async def spawn_ffmpeg(rtmp_url: str, settings: StreamSettings):
    # x264 cannot change resolution once it has started, and the studio drops
    # resolution mid-broadcast when the uplink falls behind. Pinning a scaler to
    # whatever the browser opened at turns that drop into a softer picture
    # instead of a dead encoder. Padding keeps the aspect ratio honest if a
    # lower rung is shaped differently.
    scale_filter = (
        f"scale={settings.width}:{settings.height}"
        ":force_original_aspect_ratio=decrease,"
        f"pad={settings.width}:{settings.height}:(ow-iw)/2:(oh-ih)/2,"
        "format=yuv420p"
    )
    # Headroom over the browser's target so the transcode is not the bottleneck,
    # but still bounded — an unbounded CRF spike stutters rather than errors.
    maxrate = int(settings.video_bitrate * 1.3)
    gop = settings.fps

    cmd = [
        str(FFMPEG),
        "-loglevel",
        "warning",
        "-fflags",
        "+genpts+flush_packets",
        "-flags",
        "+low_delay",
        # These were 32 bytes / 0 microseconds — ffmpeg's absolute minimum,
        # presumably chasing startup latency. It is far too little to parse the
        # WebM header and find the H264 parameter sets: ffmpeg warned "not
        # enough frames to estimate rate" on every session and emitted a stream
        # whose video had no SPS/PPS, so MediaMTX received nothing usable,
        # closed the RTMP connection on its 10s read timeout, and ffmpeg died
        # with a broken pipe a few seconds into every broadcast.
        # 2s of analysis covers two 1s GOPs, so a keyframe is always seen. This
        # is a one-time startup cost, not added steady-state latency.
        "-probesize",
        "5000000",
        "-analyzeduration",
        "2000000",
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
        "-vf",
        scale_filter,
        # Normalises frame rate too. The studio thins its redraws to shed load,
        # so the arriving stream can drop well below its nominal rate; without
        # this the GOP length would drift and HLS segments would stop aligning.
        "-r",
        str(settings.fps),
        # One keyframe per second, matching hlsSegmentDuration in mediamtx.yml so
        # segments cut on GOP boundaries.
        "-g",
        str(gop),
        "-keyint_min",
        str(gop),
        "-sc_threshold",
        "0",
        "-maxrate",
        f"{maxrate}",
        "-bufsize",
        f"{maxrate * 2}",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-b:a",
        str(settings.audio_bitrate),
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
    return proc, stderr_task


async def run_session(ws, rtmp_url: str) -> None:
    """Reads the browser's control messages and media, feeding ffmpeg.

    ffmpeg is spawned lazily, after the browser has said what it is about to
    send. It opens with a bandwidth probe — padding we must swallow rather than
    hand to the demuxer, since it is not WebM — and the resolution and bitrate it
    settles on decide how the transcode is configured. Starting ffmpeg before
    that would mean transcoding to a guess.
    """
    settings = StreamSettings()
    proc = None
    stderr_task = None
    probing = False
    probe_bytes = 0
    probe_started = time.monotonic()

    # Log what the browser actually delivers. Without this it is impossible to
    # tell "the browser stopped sending" from "ffmpeg could not parse what it
    # sent" — both surface identically as a broken pipe here.
    total = 0
    chunks = 0
    started = time.monotonic()
    last_report = started

    try:
        async for message in ws:
            if isinstance(message, str):
                try:
                    payload = json.loads(message)
                except ValueError:
                    continue

                event = payload.get("event")
                if event == "probe":
                    probing = True
                    probe_bytes = 0
                    probe_started = time.monotonic()
                elif event == "probe_end":
                    probing = False
                    # Time it here, not in the browser. A WebSocket's
                    # bufferedAmount only reports the local send queue, and the
                    # kernel will happily swallow half a megabyte before a single
                    # byte crosses the network — so measuring it client-side
                    # reports how fast the socket buffer filled, not how fast the
                    # connection is. Only this end knows when the bytes landed.
                    elapsed_ms = (time.monotonic() - probe_started) * 1000
                    print(
                        f"[ws-ingest] probe: {probe_bytes} bytes in "
                        f"{elapsed_ms:.0f}ms, discarded",
                        flush=True,
                    )
                    await ws.send(json.dumps({
                        "event": "probe_result",
                        "bytes": probe_bytes,
                        "ms": round(elapsed_ms),
                    }))
                elif event == "start":
                    settings = StreamSettings(payload)
                    print(f"[ws-ingest] browser opening at {settings}", flush=True)
                continue

            if not isinstance(message, bytes):
                continue

            if probing:
                probe_bytes += len(message)
                continue

            if proc is None:
                proc, stderr_task = await spawn_ffmpeg(rtmp_url, settings)
                started = time.monotonic()
                last_report = started

            assert proc.stdin is not None
            total += len(message)
            chunks += 1
            proc.stdin.write(message)
            await proc.stdin.drain()

            now = time.monotonic()
            if now - last_report >= 2:
                elapsed = now - started
                kbps = (total * 8 / 1000) / elapsed if elapsed > 0 else 0
                print(
                    f"[ws-ingest] rx {total} bytes in {chunks} chunks "
                    f"over {elapsed:.1f}s ({kbps:.0f} kbps)",
                    flush=True,
                )
                last_report = now

        print(
            f"[ws-ingest] websocket ended: {total} bytes in {chunks} chunks "
            f"over {time.monotonic() - started:.1f}s",
            flush=True,
        )
    finally:
        if proc is not None:
            if proc.stdin is not None:
                try:
                    proc.stdin.close()
                except (BrokenPipeError, ConnectionResetError):
                    pass
            await proc.wait()
            if stderr_task is not None:
                stderr_task.cancel()
            print(f"[ws-ingest] ffmpeg exited {proc.returncode}", flush=True)
        else:
            print("[ws-ingest] session ended before any media arrived", flush=True)


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
    await run_session(ws, rtmp_url)


async def main() -> None:
    if not SECRET:
        raise SystemExit("STREAM_RELAY_WEBHOOK_SECRET is required")

    async with websockets.serve(handler, HOST, PORT, max_size=8 * 1024 * 1024):
        print(f"[ws-ingest] listening on ws://{HOST}:{PORT}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: exit(0))
    asyncio.run(main())
