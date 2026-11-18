#!/usr/bin/env python3
"""Discrete-event simulation of the Sunday transcription rush.

N recordings become ready within a window; the dashboard dispatches with a global cap W
(= Modal max_containers) on enqueue ("inline kick") and on a 60 s cron tick. Each job
runs on one L4 container; containers stay warm for `scaledown_window` seconds.

All per-stage timings are ASSUMPTIONS until replaced with numbers from bench/benchmark.py
(pass --stage-file measured.json or individual flags). Pure Python, no dependencies.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import random

# Assumed timings for one 2 h recording on one L4 (seconds) - replace with measurements.
ASSUMED = {
    "cold_start_s": 50.0,       # container boot + model load from Volume
    "download_s": 60.0,         # ~4 GB of A/V fMP4 segments, 8 parallel streams
    "decode_s": 30.0,           # concat + ffmpeg AAC -> 16 kHz mono
    "langid_s": 3.0,            # only when language = auto
    "events_s": 45.0,           # YAMNet on CPU over 2 h
    "post_s": 5.0,              # segmenting, gaps, transcript callback
    "rtf_parakeet": 0.010,      # ASR seconds per audio second
    "rtf_faster_whisper": 0.025,
}
L4_PER_S = 0.000222             # Modal L4 GPU price (given)
# Modal bills CPU and memory on top of the GPU price. ASSUMED rates; verify on modal.com/pricing.
CPU_CORE_PER_S = 0.0000131
MEM_GIB_PER_S = 0.00000222


def pct(xs, p):
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = (len(xs) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def simulate(n=100, audio_sec=7200.0, window_min=60.0, workers=10, engine="parakeet",
             scaledown=120.0, cron_s=60.0, kick_on_complete=False, jitter=0.15, seed=7,
             cores=4, mem_gib=16, timings=None):
    t = {**ASSUMED, **(timings or {})}
    rnd = random.Random(seed)
    ready = sorted(rnd.uniform(0, window_min * 60) for _ in range(n))
    rtf = t[f"rtf_{engine}"]
    warm_work = t["download_s"] + t["decode_s"] + t["langid_s"] + audio_sec * rtf + t["events_s"] + t["post_s"]

    # events: (time, order, kind, payload)
    ev, seq = [], 0

    def push(time, kind, payload=None):
        nonlocal seq
        heapq.heappush(ev, (time, seq, kind, payload))
        seq += 1

    for i, r in enumerate(ready):
        push(r, "ready", i)
    last_ready = ready[-1] if ready else 0
    tick = cron_s
    while tick <= last_ready + 24 * 3600:
        push(tick, "tick")
        tick += cron_s
        if tick > last_ready + 10 * 3600:
            break

    queue: list[int] = []
    running = 0
    warm_idle: list[float] = []      # times at which idle warm containers expire
    containers_alive = 0.0           # billed container-seconds
    start, finish, cold = {}, {}, 0
    idle_since: list[float] = []

    def dispatch(now):
        nonlocal running, cold, containers_alive
        while queue and running < workers:
            i = queue.pop(0)
            # reuse a warm container if any is still within its scaledown window
            warm = [k for k, exp in enumerate(warm_idle) if exp >= now]
            if warm:
                k = warm[0]
                containers_alive += now - idle_since[k]  # idle time was billed
                warm_idle.pop(k)
                idle_since.pop(k)
                boot = 0.0
            else:
                boot = t["cold_start_s"]
                cold += 1
            dur = (boot + warm_work) * math.exp(rnd.gauss(0, jitter))
            containers_alive += dur
            running += 1
            start[i] = now
            push(now + dur, "done", i)

    while ev:
        now, _, kind, payload = heapq.heappop(ev)
        # expire warm containers (bill their full scaledown window)
        for k in range(len(warm_idle) - 1, -1, -1):
            if warm_idle[k] < now:
                containers_alive += warm_idle[k] - idle_since[k]
                warm_idle.pop(k)
                idle_since.pop(k)
        if kind == "ready":
            queue.append(payload)
            dispatch(now)                     # inline kick after enqueue
        elif kind == "tick":
            dispatch(now)
            if len(finish) == n:
                break
        elif kind == "done":
            running -= 1
            finish[payload] = now
            warm_idle.append(now + scaledown)
            idle_since.append(now)
            if kick_on_complete:
                dispatch(now)
    for k in range(len(warm_idle)):
        containers_alive += warm_idle[k] - idle_since[k]

    waits = [start[i] - ready[i] for i in range(n)]
    e2e = [finish[i] - ready[i] for i in range(n)]
    gpu_cost = containers_alive * L4_PER_S
    cpu_mem_cost = containers_alive * (cores * CPU_CORE_PER_S + mem_gib * MEM_GIB_PER_S)
    return {
        "recordings": n, "audio_hours": round(n * audio_sec / 3600, 1), "workers": workers,
        "engine": engine, "ready_window_min": window_min,
        "per_recording_warm_s": round(warm_work, 1),
        "drain_min": round((max(finish.values()) - ready[0]) / 60, 1),
        "after_last_ready_min": round((max(finish.values()) - ready[-1]) / 60, 1),
        "queue_age_p50_min": round(pct(waits, 50) / 60, 1),
        "queue_age_p95_min": round(pct(waits, 95) / 60, 1),
        "ready_to_done_p50_min": round(pct(e2e, 50) / 60, 1),
        "ready_to_done_p95_min": round(pct(e2e, 95) / 60, 1),
        "cold_starts": cold,
        "container_hours": round(containers_alive / 3600, 2),
        "cost_gpu_usd": round(gpu_cost, 2),
        "cost_cpu_mem_usd_assumed": round(cpu_mem_cost, 2),
        "cost_total_usd": round(gpu_cost + cpu_mem_cost, 2),
        "cost_per_recording_usd": round((gpu_cost + cpu_mem_cost) / n, 3),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--recordings", type=int, default=100)
    ap.add_argument("--hours", type=float, default=2.0, help="audio length per recording")
    ap.add_argument("--window-min", type=float, default=60.0, help="ready times spread over this window")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--engine", choices=["parakeet", "faster_whisper", "both"], default="both")
    ap.add_argument("--scaledown", type=float, default=120.0)
    ap.add_argument("--kick-on-complete", action="store_true")
    ap.add_argument("--stage-file", help="JSON with measured overrides for keys in ASSUMED")
    ap.add_argument("--sweep", action="store_true", help="also run workers = 5, 10, 20")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    timings = json.load(open(args.stage_file)) if args.stage_file else {}
    engines = ["parakeet", "faster_whisper"] if args.engine == "both" else [args.engine]
    workers = sorted({5, args.workers, 20}) if args.sweep else [args.workers]
    rows = [simulate(args.recordings, args.hours * 3600, args.window_min, w, e, args.scaledown,
                     kick_on_complete=args.kick_on_complete, timings=timings)
            for e in engines for w in workers]
    if args.json:
        print(json.dumps({"assumptions": {**ASSUMED, **timings}, "results": rows}, indent=2))
        return
    print("Assumptions (seconds unless noted):", json.dumps({**ASSUMED, **timings}))
    print(f"L4 ${L4_PER_S}/s; CPU/mem (assumed) 4 cores ${CPU_CORE_PER_S}/core/s + 16 GiB ${MEM_GIB_PER_S}/GiB/s")
    cols = ["engine", "workers", "per_recording_warm_s", "drain_min", "after_last_ready_min",
            "queue_age_p50_min", "queue_age_p95_min", "ready_to_done_p95_min", "cold_starts",
            "container_hours", "cost_gpu_usd", "cost_total_usd", "cost_per_recording_usd"]
    print(" | ".join(cols))
    for r in rows:
        print(" | ".join(str(r[c]) for c in cols))


if __name__ == "__main__":
    main()
