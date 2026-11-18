import os
import subprocess

import numpy as np
import pytest
from conftest import FFMPEG, JOB_ID, TOKEN, run_source

from sermon_media.jobs import Config, run_render
from sermon_media.render import (build_ass, plan_speaker_crop, probe_output, render_clip,
                                 validate_probe, wrap_text)

CUES = [{"start": 0.2, "end": 2.8, "text": "Turn with me to John chapter six, verse thirty five."},
        {"start": 3.0, "end": 5.8, "text": "I am the bread of life."}]


def media(media_server, hls, name="wide"):
    return {"kind": "segments", "timeline_duration_sec": 18.0,
            "runs": [run_source(media_server, name, 0, 0.0, hls(name))], "gaps": []}


def spec(start, end, mode="wide_fit", captions=True, x=0.5):
    return {"start_sec": start, "end_sec": end, "framing": {"mode": mode, "x": x},
            "captions": CUES, "captions_enabled": captions,
            "output": {"width": 1080, "height": 1920, "fps": 30}}


def frame(path, t):
    raw = subprocess.run([FFMPEG, "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1",
                          "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(1920, 1080).astype(np.int16)


def test_render_job_end_to_end(stub, media_server, hls):
    job = {"job_id": JOB_ID, "kind": "render_clip", "callback_base": stub.callback_base, "job_token": TOKEN}
    stub.routes["begin"] = (200, {"status": "ok", "kind": "render_clip", "params": {}})
    stub.routes["sources"] = (200, {
        "spec": spec(4.5, 10.5), "media": media(media_server, hls),
        "upload": {"signed_url": f"{stub.url}/storage/v1/object/upload/sign/clips/c/r.mp4?token=x",
                   "storage_path": "clips/c/r.mp4", "content_type": "video/mp4"}})
    assert run_render(job, cfg=Config(heartbeat_sec=0.05)) == "ok"
    assert "fail" not in stub.names()
    [r] = stub.bodies("render-result")
    p = r["probe"]
    assert validate_probe(p) == []
    assert (p["width"], p["height"], p["fps"]) == (1080, 1920, 30)
    assert p["duration_sec"] == pytest.approx(6.0, abs=0.1)
    assert p["faststart"] and p["gop_sec"] == pytest.approx(2.0, abs=0.05)
    assert (p["video_codec"], p["pix_fmt"], p["audio_codec"], p["audio_rate"], p["audio_channels"]) == \
        ("h264", "yuv420p", "aac", 48000, 2)
    assert r["framing_used"] == {"mode": "wide_fit", "fallback": False, "notes": ""}
    [up] = stub.uploads
    assert up["headers"]["x-upsert"] == "false" and up["headers"]["content-type"] == "video/mp4"
    assert up["sha256"] == r["sha256"] and up["size"] == r["byte_size"]
    assert set(r["metrics"]["stages"]) >= {"download_s", "render_s", "upload_s"}


def test_captions_are_burned_in(tmp_path, media_server, hls):
    a = render_clip({"spec": spec(4.5, 10.5, captions=True), "media": media(media_server, hls)}, str(tmp_path / "a"))
    os.makedirs(tmp_path / "b")
    b = render_clip({"spec": spec(4.5, 10.5, captions=False), "media": media(media_server, hls)}, str(tmp_path / "b"))
    fa, fb = frame(a["path"], 1.0), frame(b["path"], 1.0)
    caption_band = np.abs(fa[1050:1300] - fb[1050:1300]).mean()
    top_band = np.abs(fa[200:400] - fb[200:400]).mean()
    assert caption_band > 5 * max(top_band, 0.5)


@pytest.fixture
def workdir(tmp_path):
    os.makedirs(tmp_path / "w")
    return str(tmp_path / "w")


def test_clip_across_runs_manual(workdir, media_server, hls):
    a = run_source(media_server, "a", 0, 0.0, hls("a"))
    b = run_source(media_server, "b", 1, 18.0, hls("b"))
    m = {"kind": "segments", "timeline_duration_sec": 30.0, "runs": [a, b], "gaps": []}
    out = render_clip({"spec": spec(15.0, 21.0, mode="manual", x=0.3), "media": m}, workdir)
    assert validate_probe(out["probe"]) == []
    assert out["probe"]["duration_sec"] == pytest.approx(6.0, abs=0.1)
    assert out["framing_used"]["mode"] == "manual"


def test_speaker_mode_with_faces(workdir, media_server, hls):
    fake = lambda p: [{"t": i / 2, "cut": i == 6, "x": 0.25 if i < 6 else 0.7, "h": 0.2} for i in range(12)]
    out = render_clip({"spec": spec(4.5, 10.5, mode="speaker"), "media": media(media_server, hls)},
                      workdir, analyze=fake)
    assert out["framing_used"]["mode"] == "speaker" and not out["framing_used"]["fallback"]
    assert validate_probe(out["probe"]) == []


def test_speaker_falls_back_on_testsrc(workdir, media_server, hls):
    pytest.importorskip("cv2")
    out = render_clip({"spec": spec(4.5, 10.5, mode="speaker"), "media": media(media_server, hls)}, workdir)
    assert out["framing_used"]["fallback"] is True and out["framing_used"]["mode"] == "wide_fit"


def test_missing_segment_fails_render(workdir, media_server, hls):
    m = media(media_server, hls)
    m["runs"][0]["segments"][1]["url"] = ""
    with pytest.raises(Exception) as e:
        render_clip({"spec": spec(4.5, 10.5), "media": m}, workdir)
    assert getattr(e.value, "code", "") == "source_missing"


def test_plan_speaker_crop():
    s = [{"t": i / 2, "cut": i == 10, "x": (0.3 if i < 10 else 0.6) if i % 4 else None, "h": 0.15}
         for i in range(20)]
    plan = plan_speaker_crop(s)
    assert plan["ok"] and plan["xs"] == [(0.0, 0.3), (5.0, 0.6)]
    wide = [{"t": i / 2, "cut": False, "x": 0.5 if i % 5 == 0 else None, "h": 0.03} for i in range(20)]
    assert plan_speaker_crop(wide)["ok"] is False


def test_ass_wraps_and_escapes():
    ass = build_ass([{"start": 0, "end": 4, "text": "{\\b1}A very long caption line that needs wrapping across lines"}], 10)
    events = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert len(events) >= 2 and "{" not in "".join(events)
    assert all(len(x) <= 20 for x in wrap_text("A very long caption line that needs wrapping"))
    assert "PlayResY: 1920" in ass
