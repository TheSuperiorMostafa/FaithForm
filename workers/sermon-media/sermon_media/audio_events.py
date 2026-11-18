"""YAMNet audio events (applause, laughter, crowd, music). Optional and never fatal.

YAMNet: 16 kHz mono float input, 0.96 s frames with 0.48 s hop, 521 AudioSet classes.
Contract labels: applause | laughter | music | crowd (singing -> music, cheering -> crowd).
"""
from __future__ import annotations

import csv
import logging

log = logging.getLogger("sermon_media")

YAMNET_URL = "https://tfhub.dev/google/yamnet/1"
HOP = 0.48
WIN = 0.96

LABEL_GROUPS = {
    "applause": ["Applause", "Clapping"],
    "laughter": ["Laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"],
    "crowd": ["Cheering", "Crowd", "Chant"],
    "music": ["Music", "Singing", "Choir", "Musical instrument", "Organ", "Piano",
              "Christian music", "Gospel music", "Song"],
}
THRESHOLDS = {"applause": 0.3, "laughter": 0.3, "crowd": 0.3, "music": 0.4}
MIN_DURATION = {"applause": 1.5, "laughter": 1.0, "crowd": 1.5, "music": 8.0}


def frames_to_events(scores, class_names: list[str], offset: float = 0.0, *,
                     thresholds: dict = THRESHOLDS, min_duration: dict = MIN_DURATION,
                     max_gap_frames: int = 1) -> list[dict]:
    """Turn a [frames x classes] score matrix into labelled time ranges."""
    import numpy as np

    scores = np.asarray(scores, dtype=np.float32)
    index = {n: i for i, n in enumerate(class_names)}
    events = []
    for label, names in LABEL_GROUPS.items():
        cols = [index[n] for n in names if n in index]
        if not cols or scores.size == 0:
            continue
        g = scores[:, cols].max(axis=1)
        active = np.flatnonzero(g >= thresholds[label])
        if active.size == 0:
            continue
        runs, start, prev = [], active[0], active[0]
        for f in active[1:]:
            if f - prev > max_gap_frames + 1:
                runs.append((start, prev))
                start = f
            prev = f
        runs.append((start, prev))
        for a, b in runs:
            s, e = offset + a * HOP, offset + b * HOP + WIN
            if e - s >= min_duration[label]:
                events.append({"start": round(s, 3), "end": round(e, 3), "label": label,
                               "score": round(float(g[a:b + 1].mean()), 3)})
    return merge_events(events)


def merge_events(events: list[dict], max_gap: float = 0.5) -> list[dict]:
    out: list[dict] = []
    for ev in sorted(events, key=lambda e: (e["label"], e["start"])):
        last = out[-1] if out else None
        if last and last["label"] == ev["label"] and ev["start"] - last["end"] <= max_gap:
            span_l, span_e = last["end"] - last["start"], ev["end"] - ev["start"]
            last["score"] = round((last["score"] * span_l + ev["score"] * span_e) / (span_l + span_e), 3)
            last["end"] = max(last["end"], ev["end"])
        else:
            out.append(dict(ev))
    return sorted(out, key=lambda e: (e["start"], e["label"]))


class Yamnet:
    def __init__(self, url: str = YAMNET_URL):
        import tensorflow as tf
        import tensorflow_hub as hub

        try:  # keep the GPU for ASR; YAMNet is cheap on CPU
            tf.config.set_visible_devices([], "GPU")
        except Exception:  # noqa: BLE001
            pass
        self.model = hub.load(url)
        with tf.io.gfile.GFile(self.model.class_map_path().numpy().decode()) as f:
            self.class_names = [row["display_name"] for row in csv.DictReader(f)]

    def detect(self, wav_path: str, duration: float, chunk_sec: float = 600.0, progress=None) -> list[dict]:
        from .timeline import read_wav_slice

        events = []
        t = 0.0
        while t < duration:
            end = min(duration, t + chunk_sec)
            audio = read_wav_slice(wav_path, t, end)
            if len(audio) >= 16000:
                scores, _, _ = self.model(audio)
                events += frames_to_events(scores.numpy(), self.class_names, offset=t)
            t = end
            if progress:
                progress(t / duration)
        return merge_events(events, max_gap=WIN)


def detect_events(detector, wav_path: str, duration: float, progress=None) -> tuple[list[dict], str | None]:
    """Run a detector; on any error return ([], error_name) instead of failing the job."""
    if detector is None:
        return [], None
    try:
        return detector.detect(wav_path, duration, progress=progress), None
    except Exception as e:  # noqa: BLE001
        log.warning("audio events failed: %s", type(e).__name__)
        return [], type(e).__name__
