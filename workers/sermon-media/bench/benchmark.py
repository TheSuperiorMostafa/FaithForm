#!/usr/bin/env python3
"""Benchmark ASR engines on real service recordings (local paths or Modal Volume paths).

For each input: decode once (timed), then for each engine: model load, windowed ASR with
the production stitching, RTF, estimated L4 cost, Scripture-reference / proper-name recall
against an expected-terms list, and WER (jiwer, optional) against a reference transcript.

  python bench/benchmark.py service1.mp4 --terms terms.txt --reference service1.txt --out r.json
  modal run modal_app.py::benchmark --paths /data/service1.mp4 --terms /data/terms.txt

terms.txt: one expected term per line, e.g. "John 6:35", "Ephesians 2:8", "Pastor Okafor".
Writes each engine's transcript next to --out for manual review.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

L4_PER_S = 0.000222

_UNITS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * i for i, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "_"}
_ORD = {"first": "1", "second": "2", "third": "3", "1st": "1", "2nd": "2", "3rd": "3"}
_DROP = {"chapter", "chapters", "verse", "verses", "and", "through", "to"}


def normalize(text: str) -> str:
    """Lowercase, spell numbers as digits, drop 'chapter'/'verse', strip punctuation, so
    'John chapter six verse thirty-five' and 'John 6:35' both become 'john 6 35'."""
    text = text.lower().replace("-", " ").replace(":", " ")
    text = re.sub(r"[^\w\s']", " ", text)
    out, num = [], None
    for tok in text.split():
        tok = _ORD.get(tok, tok)
        val = _UNITS.get(tok, _TENS.get(tok))
        if tok == "hundred" and num is not None:
            num *= 100
            continue
        if val is not None:
            if num is not None and (num % 100 == 0 or (num >= 20 and num % 10 == 0 and val < 10)):
                num += val
            else:
                if num is not None:
                    out.append(str(num))
                num = val
            continue
        if num is not None:
            out.append(str(num))
            num = None
        if tok not in _DROP:
            out.append(tok)
    if num is not None:
        out.append(str(num))
    return " ".join(out)


def term_recall(hypothesis: str, terms: list[str]) -> dict:
    hyp = f" {normalize(hypothesis)} "
    missed = [t for t in terms if f" {normalize(t)} " not in hyp]
    return {"terms": len(terms), "found": len(terms) - len(missed),
            "recall": round(1 - len(missed) / len(terms), 4) if terms else None, "missed": missed}


def wer(reference: str, hypothesis: str) -> float | None:
    try:
        import jiwer
    except ImportError:
        return None
    return round(jiwer.wer(normalize(reference), normalize(hypothesis)), 4)


def gpu_name() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except ImportError:
        pass
    return "cpu"


def run_benchmark(paths: list[str], engines=("parakeet", "faster_whisper"), terms=None,
                  references=None, device: str = "cuda", window: float = 1200, overlap: float = 20,
                  out_dir: str | None = None) -> dict:
    from sermon_media import windows as W
    from sermon_media.engines import ENGINES
    from sermon_media.jobs import Config, transcribe_timeline
    from sermon_media.timeline import assemble

    terms = terms or []
    references = references or []
    cfg = Config(window_sec=window, overlap_sec=overlap)
    gpu = gpu_name()
    report = {"gpu": gpu, "window_sec": window, "overlap_sec": overlap, "results": []}
    for i, path in enumerate(paths):
        work = tempfile.mkdtemp(prefix="bench-")
        try:
            t0 = time.monotonic()
            asm = assemble({"kind": "file", "timeline_duration_sec": None,
                            "file": {"url": path, "timeline_start_sec": 0}}, work)
            decode_s = time.monotonic() - t0
            audio_sec = asm.stats.get("decoded_sec") or asm.duration
            for name in engines:
                t1 = time.monotonic()
                eng = ENGINES[name](device=device)
                load_s = time.monotonic() - t1
                t2 = time.monotonic()
                words, segs, lang, stitches = transcribe_timeline(
                    asm.wav_path, asm.runs, eng, None, cfg)
                asr_s = time.monotonic() - t2
                segments = W.build_segments(words, stitches=stitches) if words else W.segments_without_words(segs)
                text = " ".join(s["text"] for s in segments)
                warm_s = decode_s + asr_s
                row = {
                    "file": os.path.basename(path), "engine": eng.name, "gpu": gpu, "language": lang,
                    "audio_sec": round(audio_sec, 1),
                    "stages": {"decode_s": round(decode_s, 2), "load_s": round(load_s, 2),
                               "asr_s": round(asr_s, 2)},
                    "rtf": round(asr_s / audio_sec, 5),
                    "segments": len(segments), "words": len(words),
                    "uncertain_segments": sum("uncertain" in s["flags"] for s in segments),
                    "est_l4_cost_warm_usd": round(warm_s * L4_PER_S, 4),
                    "est_l4_cost_cold_usd": round((warm_s + load_s) * L4_PER_S, 4),
                }
                if terms:
                    row["term_recall"] = term_recall(text, terms)
                if i < len(references) and references[i]:
                    row["wer"] = wer(open(references[i], encoding="utf-8").read(), text)
                if out_dir:
                    os.makedirs(out_dir, exist_ok=True)
                    stem = os.path.splitext(os.path.basename(path))[0]
                    with open(os.path.join(out_dir, f"{stem}.{name}.txt"), "w", encoding="utf-8") as f:
                        f.write("\n".join(f"[{s['start']:.2f}-{s['end']:.2f}] {s['text']}" for s in segments))
                report["results"].append(row)
                del eng
                try:
                    import torch

                    torch.cuda.empty_cache()
                except ImportError:
                    pass
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--engines", default="parakeet,faster_whisper")
    ap.add_argument("--terms", help="file with one expected term per line")
    ap.add_argument("--reference", action="append", default=[], help="reference transcript per input, in order")
    ap.add_argument("--device", default="cuda")
    ap.add_argument("--window", type=float, default=1200)
    ap.add_argument("--overlap", type=float, default=20)
    ap.add_argument("--out", help="write JSON report here (transcripts alongside)")
    args = ap.parse_args(argv)
    terms = [l.strip() for l in open(args.terms, encoding="utf-8") if l.strip()] if args.terms else []
    report = run_benchmark(args.paths, args.engines.split(","), terms, args.reference, args.device,
                           args.window, args.overlap, os.path.dirname(os.path.abspath(args.out)) if args.out else None)
    text = json.dumps(report, indent=2)
    if args.out:
        open(args.out, "w").write(text)
    print(text)


if __name__ == "__main__":
    main()
