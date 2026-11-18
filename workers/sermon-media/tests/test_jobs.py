import logging

import numpy as np
import pytest
from conftest import JOB_ID, TOKEN, run_source

from sermon_media.engines import PARAKEET_LANGS, EngineSet
from sermon_media.jobs import Config, run_transcribe, validate_submit


class BeepEngine:
    """Emits a word for every loud stretch (the fixtures' tone bursts)."""
    name = "fake-parakeet"
    languages = PARAKEET_LANGS

    def __init__(self, device="cpu"):
        self.languages_seen = []

    def transcribe(self, audio, language=None):
        self.languages_seen.append(language)
        frame = 800  # 50 ms
        n = len(audio) // frame
        loud = np.sqrt((audio[: n * frame].reshape(n, frame) ** 2).mean(axis=1)) > 0.1
        words, i = [], 0
        while i < n:
            if loud[i]:
                j = i
                while j < n and loud[j]:
                    j += 1
                words.append({"w": "Amen.", "s": i * 0.05, "e": j * 0.05, "p": 0.9})
                i = j
            i += 1
        return {"language": language, "words": words, "segments": []}


class WhisperLike(BeepEngine):
    name = "fake-whisper"
    languages = None


class Detector:
    def __init__(self, lang):
        self.lang = lang

    def detect(self, audio):
        return self.lang, 0.99


class Events:
    def detect(self, wav, duration, progress=None):
        return [{"start": 2.0, "end": 4.0, "label": "applause", "score": 0.7}]


def engines(detect="en", primary_fails=False):
    def broken(device="cpu"):
        raise RuntimeError("CUDA out of memory")

    f = {"parakeet": broken if primary_fails else BeepEngine, "faster_whisper": WhisperLike}
    f["parakeet"].languages = PARAKEET_LANGS
    return EngineSet("parakeet", "faster_whisper", device="cpu", factories=f,
                     detector_factory=lambda: Detector(detect))


def sources(media_server, hls, language="en"):
    a = run_source(media_server, "a", 0, 0.0, hls("a"))
    b = run_source(media_server, "b", 1, 18.0, hls("b"), missing={0})
    return {"kind": "segments", "timeline_duration_sec": 30.0, "language": language,
            "expires_at": "2099-01-01T00:00:00Z", "runs": [a, b],
            "gaps": [{"timeline_sec": 18.0, "reason": "discontinuity"}]}


CFG = Config(window_sec=10, overlap_sec=2, heartbeat_sec=0.05, min_gap_sec=4)


def test_transcribe_end_to_end(stub, job, media_server, hls, caplog):
    caplog.set_level(logging.DEBUG)
    stub.routes["begin"] = (200, {"status": "ok", "kind": "transcribe", "params": {}})
    stub.routes["sources"] = (200, sources(media_server, hls))
    assert run_transcribe(job, engines=engines(), events_detector=Events(), cfg=CFG) == "ok"
    assert "fail" not in stub.names()
    [t] = stub.bodies("transcript")
    assert t["engine"] == "fake-parakeet" and t["language"] == "en" and t["duration_sec"] == 30.0
    starts = [s["start"] for s in t["segments"]]
    # bursts at 1, 7, 13 (run A) and 25 (run B; its first segment is missing)
    assert len(starts) == 4
    assert np.allclose(starts, [1.0, 7.0, 13.0, 25.0], atol=0.12)
    for a, b in zip(t["segments"], t["segments"][1:]):
        assert a["end"] <= b["start"]
    assert {"start": 18.0, "end": 24.0, "reason": "missing_audio"} in t["gaps"]
    assert {"start": 18.0, "end": 18.0, "reason": "discontinuity"} in t["gaps"]
    assert t["audio_events"][0]["label"] == "applause"
    m = t["metrics"]
    assert set(m["stages"]) >= {"download_s", "decode_s", "asr_s", "events_s"}
    assert m["audio_sec"] > 0 and m["rtf"] >= 0 and m["gpu"] == "L4"
    ids = {c["body"]["attempt_id"] for c in stub.calls}
    assert len(ids) == 1
    assert TOKEN not in caplog.text and "http" not in caplog.text


def test_auto_language_routes_to_fallback(stub, job, media_server, hls):
    stub.routes["begin"] = (200, {"status": "ok", "kind": "transcribe", "params": {}})
    stub.routes["sources"] = (200, sources(media_server, hls, language="auto"))
    assert run_transcribe(job, engines=engines(detect="ja"), cfg=CFG) == "ok"
    [t] = stub.bodies("transcript")
    assert t["engine"] == "fake-whisper" and t["language"] == "ja"
    assert "language" in t["metrics"]["engine_reason"]


def test_primary_load_failure_uses_fallback(stub, job, media_server, hls):
    stub.routes["begin"] = (200, {"status": "ok", "kind": "transcribe", "params": {}})
    stub.routes["sources"] = (200, sources(media_server, hls))
    assert run_transcribe(job, engines=engines(primary_fails=True), cfg=CFG) == "ok"
    assert stub.bodies("transcript")[0]["engine"] == "fake-whisper"


def test_stale_begin_exits_without_fail(stub, job):
    stub.routes["begin"] = (409, {"status": "stale"})
    assert run_transcribe(job, engines=engines(), cfg=CFG) == "stale"
    assert stub.names() == ["begin"]


def test_cancel_mid_job_stops_cleanly(stub, job, media_server, hls):
    stub.routes["begin"] = (200, {"status": "ok", "kind": "transcribe", "params": {}})
    stub.routes["sources"] = (200, sources(media_server, hls))
    stub.routes["heartbeat"] = (409, {"status": "cancelled"})

    class Slow(BeepEngine):
        def transcribe(self, audio, language=None):
            import time
            time.sleep(0.2)
            return super().transcribe(audio, language)

    es = engines()
    es.factories = {**es.factories, "parakeet": Slow}
    assert run_transcribe(job, engines=es, cfg=CFG) == "cancelled"
    assert "transcript" not in stub.names() and "fail" not in stub.names()


def test_media_error_reports_fail(stub, job, media_server, hls):
    src = sources(media_server, hls)
    for r in src["runs"]:
        r["init_url"] = ""
    stub.routes["begin"] = (200, {"status": "ok", "kind": "transcribe", "params": {}})
    stub.routes["sources"] = (200, src)
    assert run_transcribe(job, engines=engines(), cfg=CFG) == "failed"
    [f] = stub.bodies("fail")
    assert f["code"] == "no_audio" and "http" not in f["message"] and len(f["message"]) <= 300


def test_validate_submit():
    base = f"https://app.example.org/api/sermon-media/worker/{JOB_ID}"
    ok = validate_submit({"job_id": JOB_ID, "kind": "render_clip", "callback_base": base, "job_token": TOKEN})
    assert ok["kind"] == "render_clip"
    bad = [
        {"job_id": "x", "kind": "transcribe", "callback_base": base, "job_token": TOKEN},
        {"job_id": JOB_ID, "kind": "other", "callback_base": base, "job_token": TOKEN},
        {"job_id": JOB_ID, "kind": "transcribe", "callback_base": "http://evil.example/api/sermon-media/worker/" + JOB_ID, "job_token": TOKEN},
        {"job_id": JOB_ID, "kind": "transcribe", "callback_base": base.replace(JOB_ID, "other"), "job_token": TOKEN},
        {"job_id": JOB_ID, "kind": "transcribe", "callback_base": base, "job_token": "short"},
    ]
    for body in bad:
        with pytest.raises(ValueError) as e:
            validate_submit(body)
        assert TOKEN not in str(e.value)
