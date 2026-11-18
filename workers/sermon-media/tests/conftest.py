import functools
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("X264_PRESET", "veryfast")

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
if not shutil.which("ffmpeg"):
    os.environ["PATH"] = os.path.dirname(FFMPEG) + os.pathsep + os.environ["PATH"]

TOKEN = "tok_SECRET_abcdefghijklmnop_1234567890"
JOB_ID = "11111111-2222-4333-8444-555555555555"


# ---------------------------------------------------------------- fixtures: media

def make_hls(out_dir, duration, *, size="640x360", seg=6, burst=(1.0, 1.5)):
    """fMP4 HLS of testsrc2 video + a 440 Hz tone burst at [1.0, 1.5) of every 6 s."""
    os.makedirs(out_dir, exist_ok=True)
    expr = f"0.5*sin(2*PI*440*t)*between(mod(t,{seg}),{burst[0]},{burst[1]})"
    subprocess.run([
        FFMPEG, "-v", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30",
        "-f", "lavfi", "-i", f"aevalsrc='{expr}':s=48000:c=stereo",
        "-t", str(duration), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-g", str(30 * seg), "-keyint_min", str(30 * seg), "-sc_threshold", "0",
        "-c:a", "aac", "-ar", "48000",
        "-f", "hls", "-hls_time", str(seg), "-hls_segment_type", "fmp4",
        "-hls_playlist_type", "vod", "-hls_fmp4_init_filename", "init.mp4",
        "-hls_segment_filename", os.path.join(out_dir, "seg%03d.m4s"),
        os.path.join(out_dir, "index.m3u8"),
    ], check=True)
    return make_hls_list(os.path.join(out_dir, "index.m3u8"))


def run_source(base_url, name, index, start, segs, *, missing=(), unsigned=(), no_init=False):
    t = start
    out = []
    for seq, (fname, dur) in enumerate(segs):
        url = f"{base_url}/{name}/{fname}"
        if seq in missing:
            url = f"{base_url}/{name}/does-not-exist-{seq}.m4s"
        if seq in unsigned:
            url = ""
        out.append({"seq": seq, "timeline_start_sec": round(t, 3), "duration_sec": dur, "url": url})
        t += dur
    return {"index": index, "timeline_start_sec": start, "duration_sec": round(t - start, 3),
            "init_url": "" if no_init else f"{base_url}/{name}/init.mp4", "segments": out}


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


@pytest.fixture(scope="session")
def media_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("media")
    make_hls(str(d / "a"), 18)            # run A: 3 x 6 s
    make_hls(str(d / "b"), 12)            # run B: 2 x 6 s
    make_hls(str(d / "wide"), 18, size="1280x720")
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=7",
                    "-c:a", "aac", str(d / "file.m4a")], check=True)
    return d


@pytest.fixture(scope="session")
def media_server(media_dir):
    handler = functools.partial(_Quiet, directory=str(media_dir))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


@pytest.fixture(scope="session")
def hls(media_dir):
    return lambda name: make_hls_list(media_dir / name / "index.m3u8")


def make_hls_list(m3u8):
    segs, dur = [], None
    for line in open(m3u8):
        line = line.strip()
        if line.startswith("#EXTINF:"):
            dur = float(line[8:].split(",")[0])
        elif line and not line.startswith("#"):
            segs.append((line, dur))
    return segs


# ---------------------------------------------------------------- stub dashboard

class Stub:
    """Records callback/upload requests; `routes[name]` returns (status, json) or a list
    of such tuples consumed in order."""

    def __init__(self):
        self.calls = []
        self.routes = {}
        self.uploads = []
        self.lock = threading.Lock()

    def respond(self, name, body):
        r = self.routes.get(name, (200, {"status": "ok"}))
        if callable(r):
            return r(body)
        if isinstance(r, list):
            with self.lock:
                return r.pop(0) if len(r) > 1 else r[0]
        return r

    def names(self):
        return [c["name"] for c in self.calls]

    def bodies(self, name):
        return [c["body"] for c in self.calls if c["name"] == name]


@pytest.fixture
def stub():
    s = Stub()

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, status, obj):
            data = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            name = self.path.rstrip("/").split("/")[-1]
            with s.lock:
                s.calls.append({"name": name, "body": body, "auth": self.headers.get("Authorization"),
                                "path": self.path})
            status, obj = s.respond(name, body)
            self._send(status, obj)

        def do_PUT(self):
            data = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            s.uploads.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "size": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()})
            self._send(200, {"Key": self.path})

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    s.url = f"http://127.0.0.1:{srv.server_address[1]}"
    s.callback_base = f"{s.url}/api/sermon-media/worker/{JOB_ID}"
    yield s
    srv.shutdown()


@pytest.fixture
def job(stub):
    return {"job_id": JOB_ID, "kind": "transcribe", "callback_base": stub.callback_base, "job_token": TOKEN}
