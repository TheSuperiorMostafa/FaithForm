import random

import numpy as np

from sermon_media import windows as W
from sermon_media.audio_events import frames_to_events
from sermon_media.jobs import Config, transcribe_timeline
from sermon_media.timeline import TimelineWav


def truth_words(duration, seed=1):
    rnd = random.Random(seed)
    words, t, i = [], 0.2, 0
    while t < duration - 0.5:
        d = rnd.uniform(0.15, 0.45)
        words.append({"w": f"w{i}", "s": round(t, 3), "e": round(t + d, 3), "p": 0.95})
        t += d + (rnd.uniform(1.0, 2.0) if rnd.random() < 0.05 else rnd.uniform(0.05, 0.2))
        i += 1
    return words


class WindowEngine:
    """Fake engine over a ground-truth word list: returns words inside its window, edge words
    clipped and garbled (as real ASR does at a cut), times relative to the window."""
    name = "fake"

    def __init__(self, words, sr=16000):
        self.words, self.sr, self.calls = words, sr, []

    def transcribe(self, audio, language=None):
        a = self.cursor
        b = a + len(audio) / self.sr
        self.calls.append((a, b))
        out = []
        for w in self.words:
            if w["e"] <= a or w["s"] >= b:
                continue
            edge = w["s"] < a or w["e"] > b
            out.append({"w": "GARBLED" if edge else w["w"], "s": max(w["s"], a) - a,
                        "e": min(w["e"], b) - a, "p": 0.3 if edge else w["p"]})
        return {"language": "en", "words": out, "segments": []}


def test_plan_windows_cover_and_overlap():
    wins = W.plan_windows(0, 7200, 1200, 20)
    assert wins[0][0] == 0 and wins[-1][1] == 7200
    for (a0, b0), (a1, b1) in zip(wins, wins[1:]):
        assert b0 - a1 == 20
    assert all(b - a <= 1200 + 80 for a, b in wins)
    assert W.plan_windows(0, 100, 1200, 20) == [(0, 100)]


def test_window_merge_no_dup_no_drop(tmp_path):
    duration = 400.0
    truth = truth_words(duration)
    eng = WindowEngine(truth)
    wav = TimelineWav(str(tmp_path / "t.wav"), duration)
    orig = eng.transcribe

    def tracking(audio, language=None):  # tell the fake engine which window it is in
        eng.cursor = next_start.pop(0)
        return orig(audio, language)

    cfg = Config(window_sec=60, overlap_sec=10)
    next_start = [a for a, _ in W.plan_windows(0, duration, 60, 10)]
    eng.transcribe = tracking
    words, _, lang, stitches = transcribe_timeline(wav.path, [{"start": 0, "duration": duration}], eng, None, cfg)
    assert [w["w"] for w in words] == [w["w"] for w in truth]
    assert lang == "en" and len(stitches) == len(eng.calls) - 1
    for got, want in zip(words, truth):
        assert abs(got["s"] - want["s"]) < 1e-6 and abs(got["e"] - want["e"]) < 1e-6


def test_build_segments_ordered_bounded_flags():
    words = truth_words(600)
    words[10]["p"] = words[11]["p"] = words[12]["p"] = 0.1
    words.insert(5, dict(words[5]))  # duplicate timing must be clamped, not overlap
    segs = W.build_segments(words, stitches=[100.0])
    assert segs[0]["id"] == "s000001"
    for a, b in zip(segs, segs[1:]):
        assert a["start"] < a["end"] <= b["start"] < b["end"]
    for s in segs:
        assert s["end"] - s["start"] <= 30.0 + 1e-6
        for x, y in zip(s["words"], s["words"][1:]):
            assert x["s"] < x["e"] <= y["s"]
    assert any("overlap_merged" in s["flags"] for s in segs)
    low = W.build_segments([{"w": "x", "s": 0, "e": 0.3, "p": 0.2}, {"w": "y", "s": 0.4, "e": 0.6, "p": 0.3}])
    assert low[0]["flags"] == ["uncertain"]


def test_long_pause_splits_segment():
    words = [{"w": "a", "s": 0, "e": 0.3}, {"w": "b", "s": 0.4, "e": 0.6}, {"w": "c", "s": 3.0, "e": 3.3}]
    segs = W.build_segments(words)
    assert [s["text"] for s in segs] == ["a b", "c"]
    assert "conf" not in segs[0]


def test_detect_gaps_classifies(tmp_path):
    wav = TimelineWav(str(tmp_path / "g.wav"), 120.0)  # all silence
    segs = [{"start": 20.0, "end": 40.0}, {"start": 90.0, "end": 100.0}]
    src_gaps = [{"start": 60.0, "end": 66.0, "reason": "missing_audio"},
                {"start": 40.0, "end": 40.0, "reason": "discontinuity"}]
    events = [{"start": 100.0, "end": 120.0, "label": "music", "score": 0.8}]
    gaps = W.detect_gaps(wav.path, 120.0, segs, src_gaps, events, min_gap=10)
    got = [(g["start"], g["end"], g["reason"]) for g in gaps]
    assert (0.0, 20.0, "silence") in got
    assert (40.0, 40.0, "discontinuity") in got
    assert (60.0, 66.0, "missing_audio") in got
    assert (66.0, 90.0, "silence") in got and (40.0, 60.0, "silence") in got
    assert (100.0, 120.0, "music") in got


def test_yamnet_frames_to_events():
    names = ["Speech", "Applause", "Music", "Laughter"]
    scores = np.zeros((100, 4), dtype=np.float32)
    scores[10:20, 1] = 0.8      # ~5.3 s applause
    scores[30:31, 3] = 0.9      # single laughter frame: 0.96 s < 1.0 s min -> dropped
    scores[40:80, 2] = 0.7      # music, with a one-frame dip that should be bridged
    scores[60, 2] = 0.1
    ev = frames_to_events(scores, names, offset=100.0)
    labels = [(e["label"], e["start"]) for e in ev]
    assert ("applause", 100.0 + 10 * 0.48) in labels
    assert [e for e in ev if e["label"] == "music"] and len([e for e in ev if e["label"] == "music"]) == 1
    assert not [e for e in ev if e["label"] == "laughter"]
