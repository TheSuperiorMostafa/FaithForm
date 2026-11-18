"""Job orchestrators: run_transcribe / run_render, plus submit-body validation.

Logs carry the job id and stage only; never the job token or signed URLs.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
import time
import traceback
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from urllib.parse import urlparse

from . import windows as W
from .audio_events import detect_events
from .callbacks import CallbackClient, CallbackError, Heartbeat, StopJob
from .render import render_clip, sha256_file, upload
from .timeline import MediaError, assemble, expiring_soon, read_wav_slice

log = logging.getLogger("sermon_media")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
CODE_RE = re.compile(r"^[a-z0-9_]{1,60}$")
KINDS = ("transcribe", "render_clip")


def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Config:
    window_sec: float = 1200.0
    overlap_sec: float = 20.0
    heartbeat_sec: float = 30.0
    audio_events: bool = True
    uncertain_below: float = 0.6
    min_gap_sec: float = 10.0
    gpu: str = "L4"
    langid_sample_sec: float = 30.0

    @classmethod
    def from_env(cls) -> "Config":
        c = cls()
        c.window_sec = float(os.environ.get("ASR_WINDOW_SEC", c.window_sec))
        c.overlap_sec = float(os.environ.get("ASR_OVERLAP_SEC", c.overlap_sec))
        c.audio_events = _env_bool("AUDIO_EVENTS", c.audio_events)
        c.uncertain_below = float(os.environ.get("UNCERTAIN_BELOW", c.uncertain_below))
        c.gpu = os.environ.get("GPU_TYPE", c.gpu)
        return c


def validate_submit(body: object) -> dict:
    """Validate the dashboard's submit body. Error messages never echo the token."""
    if not isinstance(body, dict):
        raise ValueError("body must be a JSON object")
    job_id, kind = body.get("job_id"), body.get("kind")
    base, token = body.get("callback_base"), body.get("job_token")
    if not isinstance(job_id, str) or not UUID_RE.match(job_id):
        raise ValueError("job_id must be a UUID")
    if kind not in KINDS:
        raise ValueError("kind must be transcribe or render_clip")
    if not isinstance(token, str) or not 16 <= len(token) <= 4096:
        raise ValueError("job_token is missing or malformed")
    u = urlparse(base) if isinstance(base, str) else None
    local = u is not None and u.hostname in ("localhost", "127.0.0.1")
    if (u is None or u.scheme not in ("https",) + (("http",) if local else ())
            or u.query or not u.path.rstrip("/").endswith(f"/api/sermon-media/worker/{job_id}")):
        raise ValueError("callback_base must be https://<host>/api/sermon-media/worker/<job_id>")
    return {"job_id": job_id, "kind": kind, "callback_base": base.rstrip("/"), "job_token": token}


@dataclass
class Stages:
    stages: dict = field(default_factory=dict)

    @contextmanager
    def time(self, name: str):
        t = time.monotonic()
        try:
            yield
        finally:
            self.stages[name] = round(self.stages.get(name, 0) + time.monotonic() - t, 3)


def _fail(client: CallbackClient, job_id: str, code: str, message: str, retryable: bool,
          metrics: dict) -> None:
    code = code if CODE_RE.match(code or "") else "internal_error"
    message = client.redact(message)[:300]
    try:
        client.post("fail", {"code": code, "message": message, "retryable": bool(retryable),
                             "metrics": metrics})
    except (StopJob, CallbackError) as e:
        log.warning("job %s: fail callback not delivered (%s)", job_id, type(e).__name__)


@contextmanager
def _job(job: dict, client_factory, kind: str):
    """Shared begin/cleanup/error handling. Yields (client, ctx) where ctx collects
    metrics and the final status."""
    attempt_id = str(uuid.uuid4())
    client = client_factory(job["callback_base"], job["job_token"], attempt_id)
    workdir = tempfile.mkdtemp(prefix=f"sm-{job['job_id'][:8]}-")
    ctx = {"status": "ok", "metrics": {"stages": {}}, "workdir": workdir, "stages": Stages()}
    ctx["metrics"]["stages"] = ctx["stages"].stages
    try:
        yield client, ctx
    except StopJob as e:
        log.info("job %s: stopped (%s)", job["job_id"], e.reason)
        ctx["status"] = e.reason
    except MediaError as e:
        log.warning("job %s: %s", job["job_id"], e.code)
        ctx["status"] = "failed"
        _fail(client, job["job_id"], e.code, e.message, e.retryable, ctx["metrics"])
    except CallbackError as e:
        log.error("job %s: callback error %s", job["job_id"], client.redact(e))
        ctx["status"] = "failed"
    except Exception as e:  # noqa: BLE001
        tb = client.redact("".join(traceback.format_exception(type(e), e, e.__traceback__)))
        log.error("job %s: unexpected %s\n%s", job["job_id"], type(e).__name__, tb)
        ctx["status"] = "failed"
        _fail(client, job["job_id"], "internal_error",
              f"Something went wrong while processing this {'recording' if kind == 'transcribe' else 'clip'}.",
              True, ctx["metrics"])
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _begin(client: CallbackClient, kind: str) -> dict:
    begun = client.post("begin")
    if begun.get("kind") and begun["kind"] != kind:
        raise MediaError("kind_mismatch", "The job kind does not match this worker.", False)
    return begun.get("params") or {}


def _sources(client: CallbackClient) -> dict:
    src = client.post("sources")
    if expiring_soon(src):
        src = client.post("sources")
    return src


# ---------------------------------------------------------------- transcribe

def pick_langid_sample(wav: str, duration: float, sample_sec: float):
    """Loudest of a few candidate windows (likely speech rather than pre-service silence)."""
    import numpy as np

    best, best_rms = None, -1.0
    for frac in (0.15, 0.35, 0.5, 0.65):
        a = max(0.0, min(duration - sample_sec, duration * frac))
        x = read_wav_slice(wav, a, a + sample_sec)
        rms = float(np.sqrt((x.astype("float64") ** 2).mean())) if len(x) else 0.0
        if rms > best_rms:
            best, best_rms = x, rms
    return best


def transcribe_timeline(wav: str, runs: list[dict], engine, language: str | None, cfg: Config,
                        progress=None, check=None) -> tuple[list[dict], list[dict], str | None, list[float]]:
    """Transcribe each run in overlapping windows; returns (words, engine_segments,
    detected_language, stitch_points) on the recording timeline."""
    plans = [(r, W.plan_windows(r["start"], r["start"] + r["duration"], cfg.window_sec, cfg.overlap_sec))
             for r in runs]
    total = sum(len(p) for _, p in plans) or 1
    done = 0
    words, segs, stitches = [], [], []
    detected = None
    for _, wins in plans:
        word_res, seg_res = [], []
        for a, b in wins:
            if check:
                check()
            res = engine.transcribe(read_wav_slice(wav, a, b), language)
            detected = detected or res.get("language")
            word_res.append((a, b, [{**w, "s": w["s"] + a, "e": w["e"] + a} for w in res.get("words", [])]))
            seg_res.append((a, b, [{**s, "s": s["s"] + a, "e": s["e"] + a} for s in res.get("segments", [])]))
            done += 1
            if progress:
                progress(done / total)
        words += W.merge_windows(word_res)
        segs += W.merge_windows(seg_res)
        stitches += W.stitch_points(wins)
    return words, segs, detected, stitches


def run_transcribe(job: dict, *, engines, events_detector=None, cfg: Config | None = None,
                   client_factory=CallbackClient) -> str:
    cfg = cfg or Config.from_env()
    with _job(job, client_factory, "transcribe") as (client, ctx):
        st: Stages = ctx["stages"]
        params = _begin(client, "transcribe")
        with Heartbeat(client, cfg.heartbeat_sec) as hb:
            hb.update("sources", 0.0)
            src = _sources(client)
            hb.update("download", 0.02)
            asm = assemble(src, ctx["workdir"], progress=lambda f: hb.update(progress=0.02 + 0.2 * f))
            st.stages["download_s"] = asm.stats.get("download_s", 0.0)
            st.stages["decode_s"] = asm.stats.get("decode_s", 0.0)
            audio_sec = asm.stats.get("decoded_sec") or asm.duration

            language = (params.get("language") or src.get("language") or "auto").lower()
            if language == "auto":
                hb.update("language", 0.25)
                with st.time("langid_s"):
                    language = engines.detect_language(
                        pick_langid_sample(asm.wav_path, asm.duration, cfg.langid_sample_sec)) or None
            hb.update("asr", 0.3)
            with st.time("model_s"):
                engine, why = engines.choose(language)
            log.info("job %s: engine %s (%s)", job["job_id"], engine.name, why)
            with st.time("asr_s"):
                words, eng_segs, detected, stitches = transcribe_timeline(
                    asm.wav_path, asm.runs, engine, language, cfg,
                    progress=lambda f: hb.update(progress=0.3 + 0.5 * f), check=hb.check)

            hb.update("events", 0.82)
            events: list[dict] = []
            if cfg.audio_events and params.get("audio_events", True):
                with st.time("events_s"):
                    events, err = detect_events(events_detector, asm.wav_path, asm.duration)
                if err:
                    ctx["metrics"]["events_error"] = err
            hb.update("assemble", 0.92)
            if words:
                segments = W.build_segments(words, uncertain_below=cfg.uncertain_below, stitches=stitches)
            else:
                segments = W.segments_without_words(eng_segs, cfg.uncertain_below)
            W.flag_music_segments(segments, events)
            gaps = W.detect_gaps(asm.wav_path, asm.duration, segments, asm.gaps, events,
                                 min_gap=cfg.min_gap_sec)
            ctx["metrics"].update({
                "audio_sec": round(audio_sec, 3), "gpu": cfg.gpu, "engine": engine.name,
                "engine_reason": why,
                "rtf": round(st.stages.get("asr_s", 0) / max(audio_sec, 1e-6), 5),
            })
            hb.update("saving", 0.97)
            client.post("transcript", {
                "language": detected or language or "und",
                "engine": engine.name,
                "duration_sec": round(asm.duration, 3),
                "segments": segments,
                "gaps": gaps,
                "audio_events": events,
                "metrics": ctx["metrics"],
            })
    return ctx["status"]


# ---------------------------------------------------------------- render

def run_render(job: dict, *, cfg: Config | None = None, client_factory=CallbackClient,
               analyze=None, uploader=upload) -> str:
    cfg = cfg or Config.from_env()
    with _job(job, client_factory, "render_clip") as (client, ctx):
        st: Stages = ctx["stages"]
        _begin(client, "render_clip")
        with Heartbeat(client, cfg.heartbeat_sec) as hb:
            hb.update("sources", 0.0)
            src = _sources(client)
            hb.update("render", 0.1)
            kw = {"analyze": analyze} if analyze else {}
            out = render_clip(src, ctx["workdir"], check=hb.check, **kw)
            st.stages["download_s"] = out["stats"]["download_s"]
            st.stages["render_s"] = out["stats"]["render_s"]
            hb.update("upload", 0.85)
            if expiring_soon(src):
                src = client.post("sources")
            up = src["upload"]
            with st.time("upload_s"):
                uploader(up["signed_url"], out["path"], up.get("content_type") or "video/mp4")
            hb.check()
            client.post("render-result", {
                "storage_path": up["storage_path"],
                "byte_size": os.path.getsize(out["path"]),
                "sha256": sha256_file(out["path"]),
                "probe": out["probe"],
                "framing_used": out["framing_used"],
                "metrics": ctx["metrics"],
            })
    return ctx["status"]
