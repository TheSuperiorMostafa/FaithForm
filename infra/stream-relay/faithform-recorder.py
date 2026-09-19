#!/usr/bin/env python3
"""FaithForm livestream recorder (P15).

Records every authorized ingest as 6-second fMP4 HLS segments and uploads each
one to FaithForm within seconds, so a service is already in storage while it is
still on air. Replaces the old single-MP4 recorder, which lost its index when
killed, hit the storage size limit on anything longer than a few minutes, and
kept everything on this box until the stream ended.

    faithform-recorder.py take <mtx_path>   # started (detached) by on-stream-ready.sh
    faithform-recorder.py stop <mtx_path>   # called by on-stream-stop.sh
    faithform-recorder.py sweep             # cron, every minute: resume anything unfinished

Durability: a segment stays on disk until FaithForm acknowledges it. A take
whose recorder died (reboot, crash, app outage) is picked up by `sweep`.
Every call to FaithForm is signed (HMAC-SHA256 over timestamp, nonce and body)
and never carries the secret itself. Nothing here logs a URL, key or token.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

VERSION = "2"
HOME = Path(os.environ.get("HOME", "/home/mostafa"))
FFMPEG = os.environ.get("FFMPEG_PATH", str(HOME / "bin" / "ffmpeg"))
FFPROBE = os.environ.get("FFPROBE_PATH", str(HOME / "bin" / "ffprobe"))
APP_URL = os.environ.get("FAITHFORM_APP_URL", "https://faithform.io").rstrip("/")
SECRET = os.environ.get("STREAM_RELAY_WEBHOOK_SECRET", "")
RTSP_PORT = os.environ.get("RTSP_PORT", "8554")
TAKES = Path(os.environ.get("FAITHFORM_TAKES_DIR", str(HOME / "mediamtx" / "recordings" / "takes")))
PIDS = HOME / "mediamtx" / "pids"
SEGMENT_SECONDS = 6
FRAME_EVERY = 50  # one thumbnail candidate per ~5 minutes
BATCH = 10
KEEP_DONE_DAYS = 7
PATH_RE = re.compile(r"^live/[0-9a-fA-F-]{36}$")


def log(message):
    print(f"[recorder] {message}", flush=True)


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Signed calls to FaithForm
# ---------------------------------------------------------------------------

def call(route, payload, timeout=20):
    body = json.dumps(payload, separators=(",", ":"))
    ts = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    mac = hmac.new(SECRET.encode(), f"v1:{ts}:{nonce}:{body}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(f"{APP_URL}{route}", data=body.encode(), method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("x-faithform-relay-signature", f"v1={mac}")
    req.add_header("x-faithform-relay-timestamp", ts)
    req.add_header("x-faithform-relay-nonce", nonce)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as err:
        log(f"{route} answered {err.code}")
    except Exception as err:  # noqa: BLE001 - any transport failure is "try later"
        log(f"{route} unreachable: {type(err).__name__}")
    return None


def put(upload_url, file_path, content_type):
    data = Path(file_path).read_bytes()
    req = urllib.request.Request(upload_url, data=data, method="PUT")
    req.add_header("content-type", content_type)
    try:
        with urllib.request.urlopen(req, timeout=120):
            return len(data)
    except urllib.error.HTTPError as err:
        # Already there from an earlier attempt whose commit was lost: uploads
        # are immutable, so the object is the one we would have written.
        body = err.read().decode(errors="ignore")
        if err.code in (400, 409) and ("Duplicate" in body or "already exists" in body):
            return len(data)
        log(f"upload answered {err.code}")
    except Exception as err:  # noqa: BLE001
        log(f"upload failed: {type(err).__name__}")
    return None


# ---------------------------------------------------------------------------
# A take on disk
# ---------------------------------------------------------------------------

def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except Exception:  # noqa: BLE001
        return default


def write_json(path, value):
    tmp = Path(f"{path}.tmp")
    tmp.write_text(json.dumps(value))
    tmp.replace(path)


def parse_playlist(take_dir):
    """Closed segments, from the playlist ffmpeg writes after closing each one."""
    playlist = take_dir / "index.m3u8"
    if not playlist.exists():
        return []
    segments, duration, started = [], None, None
    for line in playlist.read_text().splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            duration = float(line[8:].split(",")[0])
        elif line.startswith("#EXT-X-PROGRAM-DATE-TIME:"):
            started = datetime.strptime(line[25:], "%Y-%m-%dT%H:%M:%S.%f%z")
        elif line and not line.startswith("#"):
            match = re.match(r"seg_(\d+)\.m4s$", line)
            if match and duration and started and (take_dir / line).exists():
                segments.append({
                    "seq": int(match.group(1)),
                    "file": line,
                    "durationSec": round(duration, 3),
                    "startedAt": started.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
                })
            duration, started = None, None
    return segments


def make_frame(take_dir, seg):
    frame = take_dir / f"frame_{seg['seq']:06d}.jpg"
    if frame.exists():
        return frame
    try:
        joined = (take_dir / "init.mp4").read_bytes() + (take_dir / seg["file"]).read_bytes()
        subprocess.run(
            [FFMPEG, "-nostdin", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1",
             "-vf", "scale=1280:-2", "-q:v", "3", "-y", str(frame)],
            input=joined, timeout=30, check=True,
        )
        return frame
    except Exception:  # noqa: BLE001 - a missing thumbnail never blocks a recording
        return None


def process_take(take_dir, final=False):
    """Uploads whatever is ready. Returns True when nothing is left to do."""
    meta = read_json(take_dir / "meta.json", None)
    if not meta:
        return True
    state = read_json(take_dir / "state.json", {"segments": {}, "init": None, "frames": {}})
    segments = parse_playlist(take_dir)
    pending = [s for s in segments if str(s["seq"]) not in state["segments"]]
    if not pending:
        return state["init"] in ("done", None) or not any(v == "done" for v in state["segments"].values())

    for start in range(0, len(pending), BATCH):
        batch = pending[start:start + BATCH]
        items = []
        if state["init"] != "done" and (take_dir / "init.mp4").exists():
            items.append({"kind": "init", "seq": 0, "bytes": (take_dir / "init.mp4").stat().st_size})
        for seg in batch:
            items.append({"kind": "segment", "seq": seg["seq"], "startedAt": seg["startedAt"],
                          "durationSec": seg["durationSec"], "bytes": (take_dir / seg["file"]).stat().st_size})
            if seg["seq"] % FRAME_EVERY == 0 and str(seg["seq"]) not in state["frames"]:
                items.append({"kind": "frame", "seq": seg["seq"], "startedAt": seg["startedAt"]})
        answer = call("/api/stream/relay/recording/prepare",
                      {"path": meta["path"], "takeId": meta["takeId"],
                       "takeStartedAt": meta["startedAt"], "items": items})
        if not answer:
            return False
        committed = []
        by_seq = {s["seq"]: s for s in batch}
        for decision in answer.get("items", []):
            kind, seq, action = decision.get("kind"), decision.get("seq"), decision.get("action")
            if kind == "segment":
                seg = by_seq.get(seq)
                if not seg:
                    continue
                if action == "skip":
                    state["segments"][str(seq)] = "skip"
                    (take_dir / seg["file"]).unlink(missing_ok=True)
                elif action == "done":
                    committed.append({"kind": "segment", "seq": seq})
                elif action == "upload":
                    size = put(decision["uploadUrl"], take_dir / seg["file"], "video/iso.segment")
                    if size:
                        committed.append({"kind": "segment", "seq": seq, "bytes": size})
            elif kind == "init" and action in ("upload", "done"):
                size = put(decision["uploadUrl"], take_dir / "init.mp4", "video/mp4") if action == "upload" else None
                if action == "done" or size:
                    committed.append({"kind": "init", "seq": 0, **({"bytes": size} if size else {})})
            elif kind == "frame":
                if action == "upload":
                    frame = make_frame(take_dir, by_seq.get(seq, {"seq": seq, "file": f"seg_{seq:06d}.m4s"}))
                    size = put(decision["uploadUrl"], frame, "image/jpeg") if frame else None
                    if size:
                        committed.append({"kind": "frame", "seq": seq, "bytes": size})
                state["frames"][str(seq)] = "handled"
        if committed:
            result = call("/api/stream/relay/recording/commit",
                          {"path": meta["path"], "takeId": meta["takeId"], "items": committed})
            if result is None:
                write_json(take_dir / "state.json", state)
                return False
            for item in committed:
                if item["kind"] == "segment":
                    state["segments"][str(item["seq"])] = "done"
                elif item["kind"] == "init":
                    state["init"] = "done"
        write_json(take_dir / "state.json", state)
    return all(str(s["seq"]) in state["segments"] for s in parse_playlist(take_dir))


def finish_take(take_dir):
    meta = read_json(take_dir / "meta.json", None)
    if not meta:
        return
    segments = parse_playlist(take_dir)
    last = max((s["seq"] for s in segments), default=None)
    if call("/api/stream/relay/recording/take",
            {"path": meta["path"], "takeId": meta["takeId"], "event": "ended",
             "at": now_iso(), "lastSeq": last}) is not None:
        (take_dir / "done").write_text(now_iso())
        log(f"take finished ({len(segments)} segments)")


def ingest_stats(mtx_path):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:9997/v3/paths/get/{mtx_path}", timeout=3) as res:
            return json.loads(res.read())
    except Exception:  # noqa: BLE001
        return {}


def probe_init(take_dir):
    try:
        out = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate",
             "-of", "json", str(take_dir / "init.mp4")],
            capture_output=True, timeout=10, check=True,
        ).stdout
        streams = json.loads(out).get("streams", [])
    except Exception:  # noqa: BLE001
        return {}
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    fps = None
    if "/" in str(video.get("avg_frame_rate", "")):
        num, den = video["avg_frame_rate"].split("/")
        fps = round(int(num) / int(den), 2) if int(den) else None
    return {"width": video.get("width"), "height": video.get("height"), "fps": fps,
            "videoCodec": video.get("codec_name"), "audioCodec": audio.get("codec_name")}


def recent_reconnects(mtx_path):
    cutoff = time.time() - 3 * 3600
    count = 0
    for meta_file in TAKES.glob("*/meta.json"):
        meta = read_json(meta_file, {})
        if meta.get("path") == mtx_path and meta_file.stat().st_mtime > cutoff:
            count += 1
    return max(0, count - 1)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_take(mtx_path):
    if not PATH_RE.match(mtx_path) or not SECRET:
        log("refusing: bad path or no secret")
        return 1
    PIDS.mkdir(parents=True, exist_ok=True)
    pidfile = PIDS / f"rec_{digest(mtx_path)}.pid"
    if pidfile.exists():
        try:
            os.kill(int(pidfile.read_text().split()[0]), 0)
            return 0  # already recording this path
        except Exception:  # noqa: BLE001
            pass

    take_id = f"{int(time.time())}_{secrets.token_hex(6)}"
    take_dir = TAKES / take_id
    take_dir.mkdir(parents=True)
    meta = {"path": mtx_path, "takeId": take_id, "startedAt": now_iso()}
    write_json(take_dir / "meta.json", meta)
    call("/api/stream/relay/recording/take", {**{k: meta[k] for k in ("path", "takeId")},
                                               "event": "started", "at": meta["startedAt"]})

    ffmpeg = subprocess.Popen(
        [FFMPEG, "-nostdin", "-loglevel", "warning", "-rtsp_transport", "tcp", "-timeout", "10000000",
         "-i", f"rtsp://127.0.0.1:{RTSP_PORT}/{mtx_path}",
         "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy",
         # Audio is normalized so every recording is AAC — browser studio sends Opus.
         "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
         "-f", "hls", "-hls_time", str(SEGMENT_SECONDS), "-hls_list_size", "0",
         "-hls_playlist_type", "event", "-hls_segment_type", "fmp4",
         "-hls_fmp4_init_filename", "init.mp4",
         "-hls_flags", "independent_segments+program_date_time+temp_file",
         "-hls_segment_filename", str(take_dir / "seg_%06d.m4s"), str(take_dir / "index.m3u8")],
        stderr=open(take_dir / "ffmpeg.log", "ab"),
    )
    pidfile.write_text(f"{os.getpid()} {ffmpeg.pid} {take_id}")
    log("recording started")

    info, last_beat, last_bytes, last_bytes_at = {}, 0.0, None, None
    while True:
        running = ffmpeg.poll() is None
        process_take(take_dir)
        if not info and (take_dir / "init.mp4").exists():
            info = probe_init(take_dir)
        if time.time() - last_beat >= 20:
            stats = ingest_stats(mtx_path)
            received, bitrate = stats.get("bytesReceived"), None
            if received is not None and last_bytes is not None and time.time() > last_bytes_at:
                bitrate = int((received - last_bytes) * 8 / 1000 / (time.time() - last_bytes_at))
            last_bytes, last_bytes_at = received, time.time()
            segs = parse_playlist(take_dir)
            state = read_json(take_dir / "state.json", {"segments": {}})
            call("/api/stream/relay/heartbeat", {
                "path": mtx_path, "takeId": take_id, "takeStartedAt": meta["startedAt"],
                "publishing": running,
                "recorder": {"running": running, "version": VERSION,
                             "lastSegmentClosedAt": segs[-1]["startedAt"] if segs else None,
                             "pendingUploads": sum(1 for s in segs if str(s["seq"]) not in state["segments"]),
                             "reconnects": recent_reconnects(mtx_path)},
                "ingest": {"bitrateKbps": bitrate, **info},
            })
            last_beat = time.time()
        if not running:
            break
        time.sleep(4)

    # The encoder is gone. Upload everything that is left, then say so.
    deadline = time.time() + 15 * 60
    while not process_take(take_dir, final=True) and time.time() < deadline:
        time.sleep(10)
    finish_take(take_dir)
    pidfile.unlink(missing_ok=True)
    return 0


def cmd_stop(mtx_path):
    pidfile = PIDS / f"rec_{digest(mtx_path)}.pid"
    try:
        _, ffmpeg_pid, _ = pidfile.read_text().split()
        # SIGINT lets ffmpeg close the segment in progress and the playlist.
        os.kill(int(ffmpeg_pid), signal.SIGINT)
    except Exception:  # noqa: BLE001 - nothing running is fine
        pass
    return 0


def cmd_sweep():
    if not TAKES.exists() or not SECRET:
        return 0
    active = set()
    for pidfile in PIDS.glob("rec_*.pid"):
        try:
            pid, _, take_id = pidfile.read_text().split()
            os.kill(int(pid), 0)
            active.add(take_id)
        except Exception:  # noqa: BLE001
            continue
    started = time.time()
    for take_dir in sorted(TAKES.iterdir()):
        if not take_dir.is_dir() or take_dir.name in active:
            continue
        done = take_dir / "done"
        if done.exists():
            if time.time() - done.stat().st_mtime > KEEP_DONE_DAYS * 86400:
                for child in take_dir.iterdir():
                    child.unlink(missing_ok=True)
                take_dir.rmdir()
            continue
        if time.time() - started > 50:
            break  # the next sweep continues
        log(f"resuming take {take_dir.name}")
        if process_take(take_dir, final=True):
            finish_take(take_dir)
    return 0


def main(argv):
    if len(argv) >= 3 and argv[1] == "take":
        return cmd_take(argv[2])
    if len(argv) >= 3 and argv[1] == "stop":
        return cmd_stop(argv[2])
    if len(argv) >= 2 and argv[1] == "sweep":
        return cmd_sweep()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
