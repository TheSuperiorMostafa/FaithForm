import numpy as np
import pytest
from conftest import run_source

from sermon_media.timeline import MediaError, assemble, read_wav_slice


def rms(wav, a, b):
    x = read_wav_slice(wav, a, b)
    return float(np.sqrt((x ** 2).mean())) if len(x) else 0.0


def burst_present(wav, t):
    """Tone burst at [t, t+0.5): loud inside, quiet just before."""
    return rms(wav, t + 0.1, t + 0.4) > 0.1 and rms(wav, t - 0.6, t - 0.1) < 0.02


def two_runs(media_server, hls, **kw_b):
    a = run_source(media_server, "a", 0, 0.0, hls("a"))
    b = run_source(media_server, "b", 1, a["duration_sec"], hls("b"), **kw_b)
    return {"kind": "segments", "timeline_duration_sec": a["duration_sec"] + b["duration_sec"],
            "language": "en", "runs": [a, b],
            "gaps": [{"timeline_sec": a["duration_sec"], "reason": "discontinuity"}]}


def test_assembles_runs_on_timeline(tmp_path, media_server, hls):
    src = two_runs(media_server, hls)
    asm = assemble(src, str(tmp_path))
    assert asm.duration == pytest.approx(30.0, abs=0.01)
    for seg_start in (0, 6, 12, 18, 24):  # every segment's burst at +1.0 s
        assert burst_present(asm.wav_path, seg_start + 1.0), seg_start
    assert [g["reason"] for g in asm.gaps] == ["discontinuity"]
    assert asm.gaps[0]["start"] == asm.gaps[0]["end"] == pytest.approx(18.0)
    assert [r["start"] for r in asm.runs] == [0.0, 18.0]


@pytest.mark.parametrize("how", ["missing", "unsigned"])
def test_missing_segment_becomes_gap_and_keeps_offsets(tmp_path, media_server, hls, how):
    kw = {"missing": {0}} if how == "missing" else {"unsigned": {0}}
    src = two_runs(media_server, hls, **kw)  # run B segment 0 = timeline [18, 24)
    asm = assemble(src, str(tmp_path))
    miss = [g for g in asm.gaps if g["reason"] == "missing_audio"]
    assert miss == [{"start": 18.0, "end": 24.0, "reason": "missing_audio"}]
    assert rms(asm.wav_path, 18.0, 24.0) < 1e-4          # padded with silence
    assert burst_present(asm.wav_path, 25.0)              # later offsets unchanged
    assert burst_present(asm.wav_path, 13.0)


def test_unsigned_init_marks_whole_run_missing(tmp_path, media_server, hls):
    src = two_runs(media_server, hls, no_init=True)
    asm = assemble(src, str(tmp_path))
    assert {"start": 18.0, "end": 30.0, "reason": "missing_audio"} in asm.gaps
    assert burst_present(asm.wav_path, 7.0)
    assert rms(asm.wav_path, 18.0, 30.0) < 1e-4


def test_corrupt_segment_isolated(tmp_path, media_server, hls, media_dir):
    bad = media_dir / "a" / "corrupt.m4s"
    bad.write_bytes(b"\x00garbage" * 500)
    src = two_runs(media_server, hls)
    src["runs"][0]["segments"][1]["url"] = f"{media_server}/a/corrupt.m4s"
    asm = assemble(src, str(tmp_path))
    assert {"start": 6.0, "end": 12.0, "reason": "missing_audio"} in asm.gaps
    assert burst_present(asm.wav_path, 1.0) and burst_present(asm.wav_path, 13.0)


def test_file_kind_with_null_duration_uses_probe(tmp_path, media_server):
    src = {"kind": "file", "timeline_duration_sec": None,
           "file": {"url": f"{media_server}/file.m4a", "timeline_start_sec": 0}}
    asm = assemble(src, str(tmp_path))
    assert asm.duration == pytest.approx(7.0, abs=0.1)
    assert rms(asm.wav_path, 1, 6) > 0.05


def test_no_audio_at_all_fails(tmp_path, media_server, hls):
    src = two_runs(media_server, hls, no_init=True)
    src["runs"][0]["init_url"] = ""
    with pytest.raises(MediaError) as e:
        assemble(src, str(tmp_path))
    assert e.value.code == "no_audio"
