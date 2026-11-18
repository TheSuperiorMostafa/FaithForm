"""Download recording media and assemble a 16 kHz mono PCM WAV on the recording timeline.

Segments runs: init + consecutive fMP4 segments. Each run is decoded independently and
placed at its `timeline_start_sec`. A missing or undecodable segment becomes a
`missing_audio` gap filled with silence of its playlist duration, so later offsets stay
exact. File recordings are decoded directly from the signed URL.
"""
from __future__ import annotations

import datetime as dt
import os
import shutil
import struct
import subprocess
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .callbacks import redact

SR = 16000
BYTES_PER_SAMPLE = 2
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")


class MediaError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def run_ffmpeg(args: list[str], *, binary: str = FFMPEG, timeout: float | None = None,
               cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run ffmpeg/ffprobe; raise MediaError with redacted stderr (inputs may be signed URLs)."""
    cmd = [binary, "-nostdin", "-hide_banner", "-v", "error", *args] if binary == FFMPEG else [binary, *args]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        raise MediaError("ffmpeg_timeout", "Media processing took too long.") from None
    if proc.returncode != 0:
        tail = redact(proc.stderr.decode(errors="replace")[-600:])
        raise MediaError("ffmpeg_failed", f"ffmpeg exited {proc.returncode}: {tail}")
    return proc


def download(url: str, dest: str, *, timeout: float = 60, tries: int = 4) -> int:
    """Stream a URL to a file with bounded retries. Errors never include the URL."""
    last = ""
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as resp, open(dest, "wb") as f:
                shutil.copyfileobj(resp, f, 1 << 20)
            return os.path.getsize(dest)
        except Exception as e:  # noqa: BLE001 - classify below
            code = getattr(e, "code", None)
            last = f"HTTP {code}" if code else type(e).__name__
            if code is not None and 400 <= code < 500 and code not in (408, 429):
                break  # missing/forbidden: retrying will not help
            time.sleep(min(8, 0.5 * 2 ** attempt))
    raise MediaError("download_failed", f"Download failed ({last}).")


def expiring_soon(sources: dict, margin_sec: float = 300) -> bool:
    exp = sources.get("expires_at")
    if not exp:
        return False
    try:
        t = dt.datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
    except ValueError:
        return False
    return (t - dt.datetime.now(dt.timezone.utc)).total_seconds() < margin_sec


# ---------------------------------------------------------------- run downloads

@dataclass
class RunFiles:
    index: int
    timeline_start: float
    duration: float
    init_path: str | None
    segments: list[tuple[dict, str | None]]  # (segment, local path or None if missing)


def download_runs(runs: list[dict], workdir: str, *, concurrency: int = 8,
                  segment_filter=None) -> tuple[list[RunFiles], dict]:
    """Download init + segments of every run concurrently. `segment_filter(run, seg)`
    can limit segments (used by render). Failures are recorded, not raised."""
    jobs: list[tuple[str, str]] = []
    plan = []
    for run in runs:
        rdir = os.path.join(workdir, f"run{int(run['index']):03d}")
        os.makedirs(rdir, exist_ok=True)
        init = os.path.join(rdir, "init.mp4")
        jobs.append((run.get("init_url") or "", init))
        segs = []
        for seg in run.get("segments", []):
            if segment_filter and not segment_filter(run, seg):
                continue
            p = os.path.join(rdir, f"seg{int(seg['seq']):06d}.m4s")
            jobs.append((seg.get("url") or "", p))
            segs.append((seg, p))
        plan.append((run, init, segs))

    ok: dict[str, bool] = {}
    total = 0

    def fetch(job):
        url, dest = job
        if not url:  # dashboard could not sign it (object missing in storage)
            return dest, None
        try:
            return dest, download(url, dest)
        except MediaError:
            return dest, None

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        for dest, size in pool.map(fetch, jobs):
            ok[dest] = size is not None and size > 0
            total += size or 0

    out = [
        RunFiles(
            index=int(run["index"]),
            timeline_start=float(run["timeline_start_sec"]),
            duration=float(run["duration_sec"]),
            init_path=init if ok.get(init) else None,
            segments=[(seg, p if ok.get(p) else None) for seg, p in segs],
        )
        for run, init, segs in plan
    ]
    stats = {"bytes": total, "files": len(jobs), "failed": sum(1 for v in ok.values() if not v)}
    return out, stats


def concat_files(paths: list[str], out: str) -> str:
    with open(out, "wb") as f:
        for p in paths:
            with open(p, "rb") as src:
                shutil.copyfileobj(src, f, 1 << 20)
    return out


# ---------------------------------------------------------------- WAV assembly

def _wav_header(n_samples: int) -> bytes:
    data = n_samples * BYTES_PER_SAMPLE
    return (b"RIFF" + struct.pack("<I", 36 + data) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, SR, SR * BYTES_PER_SAMPLE, BYTES_PER_SAMPLE, 16)
            + b"data" + struct.pack("<I", data))


class TimelineWav:
    """A pre-sized (zero = silence) 16 kHz mono s16 WAV that spans the whole timeline."""

    HEADER = 44

    def __init__(self, path: str, duration: float):
        self.path = path
        self.n = int(round(duration * SR))
        with open(path, "wb") as f:
            f.write(_wav_header(self.n))
            f.truncate(self.HEADER + self.n * BYTES_PER_SAMPLE)

    def place(self, pcm_path: str, start_sec: float, expected_sec: float | None) -> float:
        """Copy raw s16le PCM at `start_sec`, truncated to `expected_sec` (padding stays silent)."""
        first = int(round(start_sec * SR))
        limit = self.n - first
        if expected_sec is not None:
            limit = min(limit, int(round(expected_sec * SR)))
        remaining = max(0, limit) * BYTES_PER_SAMPLE
        written = 0
        with open(pcm_path, "rb") as src, open(self.path, "r+b") as dst:
            dst.seek(self.HEADER + first * BYTES_PER_SAMPLE)
            while remaining > 0:
                chunk = src.read(min(remaining, 1 << 20))
                if not chunk:
                    break
                dst.write(chunk)
                remaining -= len(chunk)
                written += len(chunk)
        return written / BYTES_PER_SAMPLE / SR


def decode_to_pcm(src: str, out_pcm: str, *, start: float | None = None,
                  duration: float | None = None, timeout: float | None = None) -> str:
    args = []
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    if duration is not None:
        args += ["-t", f"{duration:.3f}"]
    args += ["-i", src, "-vn", "-sn", "-dn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-y", out_pcm]
    run_ffmpeg(args, timeout=timeout)
    return out_pcm


@dataclass
class Assembly:
    wav_path: str
    duration: float
    runs: list[dict]          # {index, start, duration}
    gaps: list[dict]          # {start, end, reason}
    stats: dict = field(default_factory=dict)


def _add_gap(gaps: list[dict], start: float, end: float, reason: str) -> None:
    if gaps and gaps[-1]["reason"] == reason and abs(gaps[-1]["end"] - start) < 1e-3:
        gaps[-1]["end"] = round(end, 3)
    else:
        gaps.append({"start": round(start, 3), "end": round(end, 3), "reason": reason})


def _spans(rf: RunFiles):
    """Split a run's segments into maximal spans of downloaded segments and missing ones."""
    span: list[tuple[dict, str]] = []
    for seg, path in rf.segments:
        if path is None:
            if span:
                yield "ok", span
                span = []
            yield "missing", [(seg, None)]
        else:
            span.append((seg, path))
    if span:
        yield "ok", span


def assemble_segments(sources: dict, workdir: str, *, concurrency: int = 8,
                      progress=None) -> Assembly:
    runs = sorted(sources.get("runs", []), key=lambda r: float(r["timeline_start_sec"]))
    duration = float(sources.get("timeline_duration_sec") or 0) or (
        max((float(r["timeline_start_sec"]) + float(r["duration_sec"]) for r in runs), default=0.0))
    if duration <= 0:
        raise MediaError("no_media", "The recording has no media to process.", retryable=False)

    t0 = time.monotonic()
    files, stats = download_runs(runs, workdir, concurrency=concurrency)
    stats["download_s"] = round(time.monotonic() - t0, 3)

    t1 = time.monotonic()
    wav = TimelineWav(os.path.join(workdir, "timeline.wav"), duration)
    gaps: list[dict] = []
    decoded_sec = 0.0
    for i, rf in enumerate(files):
        if rf.init_path is None:
            _add_gap(gaps, rf.timeline_start, rf.timeline_start + rf.duration, "missing_audio")
            continue
        for kind, span in _spans(rf):
            s0 = float(span[0][0]["timeline_start_sec"])
            dur = sum(float(seg["duration_sec"]) for seg, _ in span)
            if kind == "missing":
                _add_gap(gaps, s0, s0 + dur, "missing_audio")
                continue
            decoded_sec += _decode_span(rf, span, wav, workdir, gaps)
        if progress:
            progress((i + 1) / len(files))
    stats["decode_s"] = round(time.monotonic() - t1, 3)
    stats["decoded_sec"] = round(decoded_sec, 3)

    for g in sources.get("gaps", []) or []:
        t = round(float(g["timeline_sec"]), 3)
        reason = "discontinuity" if g.get("reason") == "discontinuity" else "missing_audio"
        if not any(x["start"] <= t <= x["end"] and x["reason"] == reason for x in gaps):
            gaps.append({"start": t, "end": t, "reason": reason})
    gaps.sort(key=lambda g: (g["start"], g["end"]))
    if decoded_sec <= 0:
        raise MediaError("no_audio", "No audio could be decoded from the recording.")
    return Assembly(wav.path, duration,
                    [{"index": r.index, "start": r.timeline_start, "duration": r.duration} for r in files],
                    gaps, stats)


def _decode_span(rf: RunFiles, span, wav: TimelineWav, workdir: str, gaps: list[dict]) -> float:
    """Decode init+span; on failure fall back to per-segment decoding to isolate bad ones."""
    base = os.path.join(workdir, f"run{rf.index:03d}_span{int(span[0][0]['seq']):06d}")
    s0 = float(span[0][0]["timeline_start_sec"])
    dur = sum(float(seg["duration_sec"]) for seg, _ in span)
    try:
        concat_files([rf.init_path] + [p for _, p in span], base + ".mp4")
        decode_to_pcm(base + ".mp4", base + ".pcm")
        decoded = os.path.getsize(base + ".pcm") / BYTES_PER_SAMPLE / SR
        if decoded < dur - max(0.5, 0.02 * dur):
            # ffmpeg can stop or resync silently at a corrupt fragment; a short decode
            # would shift later audio, so isolate the bad segment instead.
            raise MediaError("short_decode", "short decode")
        return wav.place(base + ".pcm", s0, dur)
    except MediaError:
        if len(span) == 1:
            _add_gap(gaps, s0, s0 + dur, "missing_audio")
            return 0.0
        return sum(_decode_span(rf, [item], wav, workdir, gaps) for item in span)
    finally:
        for ext in (".mp4", ".pcm"):
            if os.path.exists(base + ext):
                os.remove(base + ext)


def probe_duration(src: str) -> float | None:
    try:
        proc = run_ffmpeg(["-v", "error", "-show_entries", "format=duration", "-of",
                           "default=nw=1:nk=1", src], binary=FFPROBE)
        return float(proc.stdout.decode().strip())
    except (MediaError, ValueError):
        return None


def assemble_file(sources: dict, workdir: str) -> Assembly:
    """File recording: decode audio straight from the signed URL (ffmpeg streams it)."""
    t0 = time.monotonic()
    pcm = os.path.join(workdir, "file.pcm")
    decode_to_pcm(sources["file"]["url"], pcm)
    decoded = os.path.getsize(pcm) / BYTES_PER_SAMPLE / SR
    if decoded <= 0:
        raise MediaError("no_audio", "No audio could be decoded from the recording.")
    start = float(sources["file"].get("timeline_start_sec") or 0.0)
    duration = float(sources.get("timeline_duration_sec") or 0)
    if duration <= 0:  # may be null for files: use the container duration
        duration = start + (probe_duration(sources["file"]["url"]) or decoded)
    wav = TimelineWav(os.path.join(workdir, "timeline.wav"), duration)
    wav.place(pcm, start, duration - start)
    os.remove(pcm)
    elapsed = round(time.monotonic() - t0, 3)
    return Assembly(wav.path, duration, [{"index": 0, "start": start, "duration": duration - start}],
                    [], {"download_s": 0.0, "decode_s": elapsed, "decoded_sec": round(decoded, 3)})


def assemble(sources: dict, workdir: str, **kw) -> Assembly:
    if sources.get("kind") == "file":
        return assemble_file(sources, workdir)
    return assemble_segments(sources, workdir, **kw)


def read_wav_slice(wav_path: str, start: float, end: float):
    """Return float32 numpy samples in [start, end) of a TimelineWav."""
    import numpy as np

    first = max(0, int(round(start * SR)))
    n = max(0, int(round(end * SR)) - first)
    with open(wav_path, "rb") as f:
        f.seek(TimelineWav.HEADER + first * BYTES_PER_SAMPLE)
        raw = f.read(n * BYTES_PER_SAMPLE)
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def write_wav(path: str, samples) -> str:
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    with open(path, "wb") as f:
        f.write(_wav_header(len(pcm) // BYTES_PER_SAMPLE))
        f.write(pcm)
    return path
