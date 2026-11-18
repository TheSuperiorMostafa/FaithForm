"""Render a 9:16 Reels clip from the stitched recording timeline.

Pipeline: download only segments overlapping the clip -> one fMP4 piece per run ->
accurate input seek/trim -> framing (manual | wide_fit | speaker) -> concat -> burned ASS
captions -> loudnorm -> H.264 high / yuv420p / closed 2 s GOP / AAC 48 kHz stereo /
+faststart -> ffprobe validation -> sha256 -> upload to the signed URL.
"""
from __future__ import annotations

import hashlib
import json
import os
import statistics
import struct
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from .timeline import FFPROBE, MediaError, concat_files, download_runs, run_ffmpeg

REELS = {"min_w": 540, "min_h": 960, "fps": (24, 60), "dur": (3.0, 90.0), "gop": (2.0, 5.0)}
CAPTION_FONT = os.environ.get("CAPTION_FONT", "DejaVu Sans")


# ---------------------------------------------------------------- source pieces

@dataclass
class Piece:
    path: str          # local file or URL (file recordings)
    offset: float      # seek offset inside `path`
    duration: float
    width: int = 0
    height: int = 0
    has_audio: bool = True


def validate_spec(spec: dict) -> None:
    start, end = float(spec["start_sec"]), float(spec["end_sec"])
    lo, hi = REELS["dur"]
    if not (lo <= end - start <= hi) or start < 0:
        raise MediaError("invalid_clip_spec", f"Clips must be between {lo:g} and {hi:g} seconds.", False)
    out = spec.get("output") or {}
    w, h, fps = int(out.get("width", 1080)), int(out.get("height", 1920)), int(out.get("fps", 30))
    if w * 16 != h * 9 or w < REELS["min_w"] or not (REELS["fps"][0] <= fps <= REELS["fps"][1]):
        raise MediaError("invalid_clip_spec", "The clip output size or frame rate is not supported.", False)


def prepare_pieces(media: dict, start: float, end: float, workdir: str,
                   margin: float = 1.0) -> tuple[list[Piece], dict]:
    if media.get("kind") == "file":
        f = media["file"]
        p = Piece(f["url"], start - float(f.get("timeline_start_sec") or 0), end - start)
        return [p], {"bytes": 0}

    def wanted(run, seg):
        s = float(seg["timeline_start_sec"])
        return s < end + margin and s + float(seg["duration_sec"]) > start - margin

    runs = [r for r in media.get("runs", [])
            if float(r["timeline_start_sec"]) < end
            and float(r["timeline_start_sec"]) + float(r["duration_sec"]) > start]
    files, stats = download_runs(runs, workdir, segment_filter=wanted)
    pieces = []
    for rf in sorted(files, key=lambda r: r.timeline_start):
        a, b = max(start, rf.timeline_start), min(end, rf.timeline_start + rf.duration)
        if b - a < 0.05:
            continue
        if rf.init_path is None or not rf.segments or any(p is None for _, p in rf.segments):
            raise MediaError("source_missing",
                             "Part of the recording needed for this clip is missing.", False)
        out = concat_files([rf.init_path] + [p for _, p in rf.segments],
                           os.path.join(workdir, f"piece{rf.index:03d}.mp4"))
        first = float(rf.segments[0][0]["timeline_start_sec"])
        pieces.append(Piece(out, a - first, b - a))
    if not pieces:
        raise MediaError("source_missing", "The recording does not cover this clip.", False)
    return pieces, stats


def probe_streams(path: str) -> dict:
    proc = run_ffmpeg(["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
                      binary=FFPROBE)
    return json.loads(proc.stdout or b"{}")


def fill_piece_info(p: Piece) -> None:
    info = probe_streams(p.path)
    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        raise MediaError("no_video", "The recording has no video for this clip.", False)
    p.width, p.height = int(v["width"]), int(v["height"])
    p.has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))


# ---------------------------------------------------------------- framing

def cover_crop(w: int, h: int, out_w: int, out_h: int) -> tuple[int, int]:
    """Largest even crop of the source with the output aspect ratio."""
    cw = min(w, int(h * out_w / out_h))
    ch = min(h, int(cw * out_h / out_w))
    return cw - cw % 2, ch - ch % 2


def crop_x(x_norm: float, w: int, cw: int) -> int:
    x = int(round(x_norm * w - cw / 2))
    return max(0, min(w - cw, x)) // 2 * 2


def crop_chain(p: Piece, xs: list[tuple[float, float]], out: dict) -> str:
    """Crop at constant x per shot; xs = [(t_start_rel, x_norm), ...]."""
    ow, oh, fps = out["width"], out["height"], out["fps"]
    cw, ch = cover_crop(p.width, p.height, ow, oh)
    expr = str(crop_x(xs[-1][1], p.width, cw))
    # nested if(): x for t < t_{k+1} is x_k
    for k in range(len(xs) - 2, -1, -1):
        expr = f"if(lt(t,{xs[k + 1][0]:.3f}),{crop_x(xs[k][1], p.width, cw)},{expr})"
    y = (p.height - ch) // 2 // 2 * 2
    return (f"fps={fps},crop={cw}:{ch}:'{expr}':{y},scale={ow}:{oh}:flags=lanczos,"
            f"setsar=1,format=yuv420p")


def wide_fit_chain(label: str, out: dict) -> str:
    """Whole frame scaled to width over a blurred, scaled fill. Returns a graph fragment
    reading [{label}in] and writing [{label}]."""
    ow, oh, fps = out["width"], out["height"], out["fps"]
    return (f"[{label}in]fps={fps},split=2[{label}b][{label}f];"
            f"[{label}b]scale={ow // 4}:{oh // 4}:force_original_aspect_ratio=increase,"
            f"crop={ow // 4}:{oh // 4},boxblur=12:2,scale={ow}:{oh},eq=brightness=-0.08[{label}bg];"
            f"[{label}f]scale={ow}:-2:flags=lanczos[{label}fg];"
            f"[{label}bg][{label}fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[{label}]")


def plan_speaker_crop(samples: list[dict], *, min_rate: float = 0.6, min_face_h: float = 0.06,
                      min_ok_fraction: float = 0.7, merge_dx: float = 0.03) -> dict:
    """samples: [{"t", "cut": bool, "x": face centre 0..1 or None, "h": face height 0..1}].
    Returns {"ok", "xs": [(t, x)], "notes"}; ok=False means use wide_fit."""
    if not samples:
        return {"ok": False, "xs": [], "notes": "no frames sampled"}
    shots, cur = [], []
    for s in samples:
        if cur and s.get("cut"):
            shots.append(cur)
            cur = []
        cur.append(s)
    shots.append(cur)
    end_t = samples[-1]["t"] + (samples[-1]["t"] - samples[0]["t"]) / max(1, len(samples) - 1)
    plans, ok_time = [], 0.0
    for i, shot in enumerate(shots):
        t0 = shot[0]["t"]
        t1 = shots[i + 1][0]["t"] if i + 1 < len(shots) else end_t
        faces = [s["x"] for s in shot if s.get("x") is not None and s.get("h", 0) >= min_face_h]
        ok = len(faces) / len(shot) >= min_rate
        if ok:
            ok_time += t1 - t0
        plans.append([t0, statistics.median(faces) if ok else None])
    total = max(1e-6, end_t - samples[0]["t"])
    if ok_time / total < min_ok_fraction:
        return {"ok": False, "xs": [],
                "notes": f"speaker found in {ok_time / total:.0%} of clip (wide or slide shots)"}
    known = [x for _, x in plans if x is not None]
    last = known[0]
    for p in plans:  # shots without a confident face keep the previous framing
        if p[1] is None:
            p[1] = last
        last = p[1]
    xs: list[tuple[float, float]] = []
    for t, x in plans:
        if xs and abs(xs[-1][1] - x) < merge_dx:
            continue
        xs.append((round(t - samples[0]["t"], 3), round(x, 4)))
    xs[0] = (0.0, xs[0][1])
    return {"ok": True, "xs": xs, "notes": f"{len(shots)} shot(s), {len(xs)} framing change(s)"}


def sample_speaker(p: Piece, fps: float = 2.0, width: int = 640) -> list[dict]:
    """Sample frames with ffmpeg, detect faces with OpenCV's bundled Haar cascade and
    scene cuts with frame differencing."""
    import cv2
    import numpy as np

    height = max(2, round(p.height * width / p.width / 2) * 2)
    proc = run_ffmpeg(["-ss", f"{p.offset:.3f}", "-t", f"{p.duration:.3f}", "-i", p.path, "-an",
                       "-vf", f"fps={fps},scale={width}:{height},format=gray",
                       "-f", "rawvideo", "-"])
    frames = np.frombuffer(proc.stdout, dtype=np.uint8)
    n = len(frames) // (width * height)
    frames = frames[: n * width * height].reshape(n, height, width)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    out, prev_small = [], None
    for i, fr in enumerate(frames):
        small = cv2.resize(fr, (64, 36), interpolation=cv2.INTER_AREA).astype(np.int16)
        cut = prev_small is not None and float(np.abs(small - prev_small).mean()) > 30
        prev_small = small
        faces = cascade.detectMultiScale(fr, scaleFactor=1.1, minNeighbors=5, minSize=(20, 20))
        x = h = None
        if len(faces):
            fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            x, h = (fx + fw / 2) / width, fh / height
        out.append({"t": i / fps, "cut": cut, "x": x, "h": h or 0.0})
    return out


# ---------------------------------------------------------------- captions

def _ass_time(t: float) -> str:
    cs = int(round(max(0.0, t) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def wrap_text(text: str, max_chars: int = 20) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > max_chars:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        lines.append(cur)
    return lines


def build_ass(cues: list[dict], duration: float, width: int = 1080, height: int = 1920,
              max_chars: int = 20, max_lines: int = 2) -> str:
    """ASS captions: large bold text with outline, bottom-centred above the Reels UI
    (MarginV keeps text out of the bottom ~1/3 reserved for captions/buttons)."""
    size = round(height * 0.04)
    margin_v = round(height * 0.33)
    margin_h = round(width * 0.08)
    head = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
        "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, "
        "Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Caption,{CAPTION_FONT},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,"
        f"-1,0,0,0,100,100,0,0,1,{max(3, size // 12)},2,2,{margin_h},{margin_h},{margin_v},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events = []
    for cue in sorted(cues, key=lambda c: float(c["start"])):
        s, e = max(0.0, float(cue["start"])), min(duration, float(cue["end"]))
        text = " ".join(str(cue.get("text", "")).replace("{", "(").replace("}", ")")
                        .replace("\\", "/").split())
        if e - s < 0.05 or not text:
            continue
        lines = wrap_text(text, max_chars)
        chunks = [lines[i:i + max_lines] for i in range(0, len(lines), max_lines)]
        weights = [sum(len(x) for x in c) for c in chunks]
        t = s
        for chunk, wgt in zip(chunks, weights):
            ce = t + (e - s) * wgt / sum(weights)
            events.append(f"Dialogue: 0,{_ass_time(t)},{_ass_time(ce)},Caption,,0,0,0,,"
                          + "\\N".join(chunk))
            t = ce
    return head + "\n".join(events) + "\n"


# ---------------------------------------------------------------- command

def build_command(pieces: list[Piece], framings: list[dict], out_path: str, out: dict,
                  duration: float, ass_name: str | None) -> list[str]:
    """framings[i] = {"mode": "crop", "xs": [(t, x)]} or {"mode": "wide_fit"}."""
    args: list[str] = []
    graph: list[str] = []
    for i, p in enumerate(pieces):
        args += ["-ss", f"{p.offset:.3f}", "-t", f"{p.duration:.3f}", "-i", p.path]
    for i, (p, fr) in enumerate(zip(pieces, framings)):
        if fr["mode"] == "wide_fit":
            graph.append(f"[{i}:v]null[v{i}in]")
            graph.append(wide_fit_chain(f"v{i}", out))
        else:
            graph.append(f"[{i}:v]{crop_chain(p, fr['xs'], out)}[v{i}]")
        if p.has_audio:
            graph.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}]")
        else:
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={p.duration:.3f}[a{i}]")
    n = len(pieces)
    joined = "".join(f"[v{i}][a{i}]" for i in range(n))
    graph.append(f"{joined}concat=n={n}:v=1:a=1[vc][ac]")
    graph.append(f"[vc]subtitles=filename={ass_name}[vout]" if ass_name else "[vc]null[vout]")
    graph.append("[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,"
                 "aformat=sample_fmts=fltp:channel_layouts=stereo[aout]")
    fps = int(out["fps"])
    gop = fps * 2
    return args + [
        "-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", os.environ.get("X264_PRESET", "medium"), "-profile:v", "high",
        "-pix_fmt", "yuv420p", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M",
        "-r", str(fps), "-fps_mode", "cfr", "-g", str(gop), "-keyint_min", str(gop),
        "-sc_threshold", "0", "-flags", "+cgop",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
        "-t", f"{duration:.3f}", "-movflags", "+faststart", "-y", out_path,
    ]


# ---------------------------------------------------------------- probe

def mp4_faststart(path: str) -> bool:
    """True when the top-level moov box precedes mdat."""
    with open(path, "rb") as f:
        size_total = os.path.getsize(path)
        pos = 0
        while pos + 8 <= size_total:
            f.seek(pos)
            size, kind = struct.unpack(">I4s", f.read(8))
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
            elif size == 0:
                size = size_total - pos
            if kind == b"moov":
                return True
            if kind == b"mdat":
                return False
            if size < 8:
                return False
            pos += size
    return False


def _rate(r: str) -> float:
    num, _, den = str(r).partition("/")
    return float(num) / float(den or 1) if float(den or 1) else 0.0


def probe_output(path: str) -> dict:
    info = probe_streams(path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), {})
    kf = run_ffmpeg(["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
                     "-show_entries", "frame=pts_time", "-of", "csv=p=0", path], binary=FFPROBE)
    times = []
    for line in kf.stdout.decode().splitlines():
        field = line.split(",")[0].strip()
        if field and field != "N/A":
            times.append(float(field))
    duration = float(info["format"].get("duration", 0))
    gaps = [b - a_ for a_, b in zip(times, times[1:])]
    fmt = info["format"].get("format_name", "")
    return {
        "container": "mp4" if "mp4" in fmt else fmt,
        "width": int(v["width"]), "height": int(v["height"]),
        "fps": round(_rate(v.get("avg_frame_rate", "0/1")), 3),
        "duration_sec": round(duration, 3),
        "video_codec": v.get("codec_name"), "pix_fmt": v.get("pix_fmt"),
        "audio_codec": a.get("codec_name"), "audio_rate": int(a.get("sample_rate", 0) or 0),
        "audio_channels": int(a.get("channels", 0) or 0),
        "faststart": mp4_faststart(path),
        "gop_sec": round(max(gaps) if gaps else duration, 3),
        "bitrate": int(info["format"].get("bit_rate", 0) or 0),
    }


def validate_probe(p: dict, out: dict | None = None) -> list[str]:
    out = out or {"width": 1080, "height": 1920, "fps": 30}
    problems = []
    if p["container"] != "mp4":
        problems.append("container")
    if (p["width"], p["height"]) != (out["width"], out["height"]) or p["width"] * 16 != p["height"] * 9:
        problems.append("size")
    if abs(p["fps"] - out["fps"]) > 0.01 or not REELS["fps"][0] <= p["fps"] <= REELS["fps"][1]:
        problems.append("fps")
    if not REELS["dur"][0] - 0.05 <= p["duration_sec"] <= REELS["dur"][1] + 0.05:
        problems.append("duration")
    if p["video_codec"] != "h264" or p["pix_fmt"] != "yuv420p":
        problems.append("video_codec")
    if p["audio_codec"] != "aac" or p["audio_rate"] != 48000 or p["audio_channels"] != 2:
        problems.append("audio")
    if not p["faststart"]:
        problems.append("faststart")
    if not REELS["gop"][0] - 0.05 <= p["gop_sec"] <= REELS["gop"][1] + 0.05 and p["duration_sec"] > REELS["gop"][1]:
        problems.append("gop")
    return problems


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def upload(signed_url: str, path: str, content_type: str = "video/mp4", *, method: str = "PUT",
           tries: int = 3, timeout: float = 120) -> None:
    """Supabase signed upload URL: PUT the raw bytes with `x-upsert: false`.
    A 409 after an earlier attempt whose response was lost means the object landed
    (paths are unique per render), so it counts as success."""
    size = os.path.getsize(path)
    last, transient_before = "", False
    for attempt in range(tries):
        try:
            with open(path, "rb") as f:
                req = urllib.request.Request(signed_url, data=f, method=method, headers={
                    "Content-Type": content_type, "Content-Length": str(size), "x-upsert": "false"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    resp.read()
            return
        except urllib.error.HTTPError as e:
            if e.code == 409 and transient_before:
                return
            last = f"HTTP {e.code}"
            if e.code < 500 and e.code not in (408, 429):
                raise MediaError("upload_failed", f"Upload was rejected ({last}).", e.code != 400) from None
        except (urllib.error.URLError, OSError) as e:
            last = type(e).__name__
        transient_before = True
        time.sleep(min(10, 2 ** attempt))
    raise MediaError("upload_failed", f"Upload failed ({last}).")


# ---------------------------------------------------------------- orchestration

def render_clip(src: dict, workdir: str, *, analyze=sample_speaker, check=None) -> dict:
    """Compute part of a render job. Returns {path, probe, framing_used, stats}."""
    check = check or (lambda: None)
    spec = src["spec"]
    validate_spec(spec)
    out = {"width": 1080, "height": 1920, "fps": 30, **(spec.get("output") or {})}
    start, end = float(spec["start_sec"]), float(spec["end_sec"])
    duration = end - start

    t0 = time.monotonic()
    pieces, dl = prepare_pieces(src["media"], start, end, workdir)
    for p in pieces:
        fill_piece_info(p)
    download_s = time.monotonic() - t0
    check()

    t1 = time.monotonic()
    framing = spec.get("framing") or {"mode": "wide_fit"}
    mode = framing.get("mode", "wide_fit")
    used = {"mode": mode, "fallback": False, "notes": ""}
    if mode == "manual":
        x = min(1.0, max(0.0, float(framing.get("x", 0.5))))
        framings = [{"mode": "crop", "xs": [(0.0, x)]} for _ in pieces]
    elif mode == "speaker":
        plans = []
        for p in pieces:
            try:
                plans.append(plan_speaker_crop(analyze(p)))
            except Exception as e:  # noqa: BLE001 - analysis must never fail the render
                plans.append({"ok": False, "xs": [], "notes": f"analysis error {type(e).__name__}"})
        if all(pl["ok"] for pl in plans):
            framings = [{"mode": "crop", "xs": pl["xs"]} for pl in plans]
            used["notes"] = "; ".join(pl["notes"] for pl in plans)
        else:
            framings = [{"mode": "wide_fit"} for _ in pieces]
            used = {"mode": "wide_fit", "requested_mode": "speaker", "fallback": True,
                    "notes": "; ".join(pl["notes"] for pl in plans if not pl["ok"])[:300]}
    else:
        used["mode"] = "wide_fit"
        framings = [{"mode": "wide_fit"} for _ in pieces]
    check()

    ass_name = None
    cues = spec.get("captions") or []
    if spec.get("captions_enabled", True) and cues:
        ass_name = "captions.ass"
        with open(os.path.join(workdir, ass_name), "w", encoding="utf-8") as f:
            f.write(build_ass(cues, duration, out["width"], out["height"]))
    out_path = os.path.join(workdir, "clip.mp4")
    cmd = build_command(pieces, framings, out_path, out, duration, ass_name)
    run_ffmpeg(cmd, cwd=workdir)  # subtitles filter gets a relative, escape-free filename
    render_s = time.monotonic() - t1

    probe = probe_output(out_path)
    problems = validate_probe(probe, out)
    if problems:
        raise MediaError("render_spec_invalid",
                         f"The rendered clip did not meet the Reels format ({', '.join(problems)}).", False)
    return {"path": out_path, "probe": probe, "framing_used": used,
            "stats": {"download_s": round(download_s, 3), "render_s": round(render_s, 3),
                      "bytes_downloaded": dl.get("bytes", 0)}}
