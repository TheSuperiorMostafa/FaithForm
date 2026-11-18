"""Windowed ASR planning, overlap stitching, segment building and gap detection.

Words are dicts {"w", "s", "e", "p"?} on the recording timeline (seconds).
"""
from __future__ import annotations

import math

PUNCT_END = (".", "?", "!", "…")


def plan_windows(start: float, end: float, window: float = 1200.0, overlap: float = 20.0,
                 min_tail: float = 60.0) -> list[tuple[float, float]]:
    """Cover [start, end) with windows of `window` seconds overlapping by `overlap`.
    A short tail (< min_tail) is folded into the previous window."""
    if end <= start:
        return []
    if window <= overlap:
        raise ValueError("window must be longer than overlap")
    out: list[tuple[float, float]] = []
    a = start
    while True:
        b = min(a + window, end)
        out.append((a, b))
        if b >= end:
            break
        a = b - overlap
    if len(out) > 1 and out[-1][1] - out[-1][0] < min_tail + overlap:
        last = out.pop()
        out[-1] = (out[-1][0], last[1])
    return out


def stitch_points(windows: list[tuple[float, float]]) -> list[float]:
    """Midpoint of each overlap between consecutive windows."""
    return [(windows[i + 1][0] + windows[i][1]) / 2 for i in range(len(windows) - 1)]


def merge_windows(results: list[tuple[float, float, list[dict]]]) -> list[dict]:
    """Merge per-window items (words or segments, absolute times) by midpoint stitching.

    An item belongs to window i iff its centre lies in [cut_{i-1}, cut_i). Both windows
    transcribe the overlap, so every spoken word is kept exactly once, and words cut
    off at a window edge (always > overlap/2 from the cut) are discarded.
    """
    results = sorted(results, key=lambda r: r[0])
    cuts = stitch_points([(a, b) for a, b, _ in results])
    merged: list[dict] = []
    for i, (_, _, items) in enumerate(results):
        lo = cuts[i - 1] if i > 0 else -math.inf
        hi = cuts[i] if i < len(cuts) else math.inf
        merged.extend(it for it in items if lo <= (it["s"] + it["e"]) / 2 < hi)
    merged.sort(key=lambda it: (it["s"], it["e"]))
    return merged


def _ms(x: float) -> float:
    return round(float(x) + 0.0, 3)


def sanitize_words(words: list[dict]) -> list[dict]:
    """Sort, drop empties, and clamp so times are strictly increasing and non-overlapping."""
    out: list[dict] = []
    prev_e = -1.0
    for w in sorted(words, key=lambda w: (w["s"], w["e"])):
        text = str(w.get("w", "")).strip()
        if not text:
            continue
        s = max(_ms(w["s"]), prev_e if prev_e >= 0 else 0.0)
        e = max(_ms(w["e"]), _ms(s + 0.001))
        item = {"w": text, "s": s, "e": e}
        if w.get("p") is not None:
            item["p"] = round(float(w["p"]), 3)
        out.append(item)
        prev_e = e
    return out


def build_segments(words: list[dict], *, max_sec: float = 30.0, pause_sec: float = 0.8,
                   sentence_sec: float = 6.0, uncertain_below: float = 0.6,
                   stitches: list[float] = ()) -> list[dict]:
    """Group words into caption-friendly segments: split at pauses >= pause_sec, at sentence
    ends once >= sentence_sec long, and never exceed max_sec."""
    words = sanitize_words(words)
    groups: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        if cur:
            gap = w["s"] - cur[-1]["e"]
            length = w["e"] - cur[0]["s"]
            sentence_done = cur[-1]["w"].endswith(PUNCT_END) and cur[-1]["e"] - cur[0]["s"] >= sentence_sec
            if gap >= pause_sec or length > max_sec or sentence_done:
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return [_segment(i, g, uncertain_below, stitches) for i, g in enumerate(groups)]


def _segment(i: int, ws: list[dict], uncertain_below: float, stitches) -> dict:
    probs = [w["p"] for w in ws if "p" in w]
    conf = round(sum(probs) / len(probs), 3) if probs else None
    flags = []
    if conf is not None and conf < uncertain_below:
        flags.append("uncertain")
    if any(ws[0]["s"] <= c <= ws[-1]["e"] for c in stitches):
        flags.append("overlap_merged")
    seg = {"id": f"s{i + 1:06d}", "start": ws[0]["s"], "end": ws[-1]["e"],
           "text": " ".join(w["w"] for w in ws), "words": ws, "conf": conf, "flags": flags}
    if conf is None:
        seg.pop("conf")
    return seg


def segments_without_words(segs: list[dict], uncertain_below: float = 0.6) -> list[dict]:
    """Normalise engine segments when no word timings exist (ordering/overlap only)."""
    out = []
    prev_e = 0.0
    for s in sorted(segs, key=lambda s: s["s"]):
        text = str(s.get("text", "")).strip()
        if not text:
            continue
        start = max(_ms(s["s"]), prev_e)
        end = max(_ms(s["e"]), _ms(start + 0.001))
        seg = {"id": f"s{len(out) + 1:06d}", "start": start, "end": end, "text": text, "flags": []}
        if s.get("p") is not None:
            seg["conf"] = round(float(s["p"]), 3)
            if seg["conf"] < uncertain_below:
                seg["flags"].append("uncertain")
        out.append(seg)
        prev_e = end
    return out


# ---------------------------------------------------------------- gaps

def _subtract(intervals: list[tuple[float, float]], holes: list[tuple[float, float]]):
    out = []
    for a, b in intervals:
        pieces = [(a, b)]
        for h0, h1 in holes:
            nxt = []
            for p0, p1 in pieces:
                if h1 <= p0 or h0 >= p1:
                    nxt.append((p0, p1))
                    continue
                if h0 > p0:
                    nxt.append((p0, h0))
                if h1 < p1:
                    nxt.append((h1, p1))
            pieces = nxt
        out.extend(pieces)
    return out


def _overlap(a0, a1, b0, b1) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def mean_db(wav_path: str, start: float, end: float, chunk: float = 60.0) -> float:
    """RMS level in dBFS of a timeline WAV region (chunked to bound memory)."""
    from .timeline import read_wav_slice

    total, n = 0.0, 0
    t = start
    while t < end:
        x = read_wav_slice(wav_path, t, min(end, t + chunk))
        total += float((x.astype("float64") ** 2).sum())
        n += len(x)
        t += chunk
    if n == 0:
        return -120.0
    return 10 * math.log10(max(total / n, 1e-12))


def detect_gaps(wav_path: str | None, duration: float, segments: list[dict],
                source_gaps: list[dict], events: list[dict] = (), *, min_gap: float = 10.0,
                silence_db: float = -45.0) -> list[dict]:
    """Classify non-speech stretches >= min_gap as silence / music / noise.

    Stretches already explained by source gaps (missing_audio) are not re-labelled.
    Zero-length discontinuity markers are passed through unchanged.
    """
    edges = [0.0]
    for s in segments:
        edges += [s["start"], s["end"]]
    edges.append(duration)
    quiet = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2) if edges[i + 1] - edges[i] >= min_gap]
    holes = [(g["start"], g["end"]) for g in source_gaps if g["end"] > g["start"]]
    out = [dict(g) for g in source_gaps]
    music = [(e["start"], e["end"]) for e in events if e["label"] == "music"]
    for a, b in _subtract(quiet, holes):
        if b - a < min_gap:
            continue
        music_cover = sum(_overlap(a, b, m0, m1) for m0, m1 in music)
        if music_cover >= 0.5 * (b - a):
            reason = "music"
        elif wav_path and mean_db(wav_path, a, b) < silence_db:
            reason = "silence"
        else:
            reason = "noise"
        out.append({"start": _ms(a), "end": _ms(b), "reason": reason})
    out.sort(key=lambda g: (g["start"], g["end"]))
    return out


def flag_music_segments(segments: list[dict], events: list[dict]) -> None:
    music = [(e["start"], e["end"]) for e in events if e["label"] == "music"]
    for s in segments:
        dur = max(1e-3, s["end"] - s["start"])
        if sum(_overlap(s["start"], s["end"], a, b) for a, b in music) > 0.5 * dur:
            s["flags"].append("music")
